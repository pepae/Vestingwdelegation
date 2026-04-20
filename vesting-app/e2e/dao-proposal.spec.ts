/**
 * E2E test: Submit vesting proposal via Azorius token-voting DAO on Sepolia
 *
 * Full lifecycle:
 *   1. beforeAll: self-delegate VTT for deployer + send GVT to DAO treasury if needed
 *   2. UI submits a proposal -> calls Azorius.submitProposal on-chain
 *   3. Test verifies the ProposalCreated event contains the exact title/description in metadata
 *   4. Proposal enters voting phase (6647-block period, not executed in test)
 */
import { test, expect } from '@playwright/test'
import { injectWallet, TEST_ADDRESS, SEPOLIA_CHAIN } from './wallet-fixture'
import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbi,
  parseAbiItem,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '../.env') })

// Azorius token-voting DAO on Sepolia
const DAO_SAFE     = '0x4A590cC4C1688E226D0d3963b77BA4213756fBC3' as const
const AZORIUS_ADDR = '0x97D1499AF25937E585026Dcd923571F19Ebf4b7A' as const
const STRATEGY     = '0x6c83E8efdF07D813943D59d45Fb777C7223e7260' as const
const VTT_TOKEN    = '0x5A5D38Eb50f1467C7609524d7D735A2192640449' as const
const GVT_TOKEN    = '0xcbAf6Bd959049f2Ecc06BF95737c83C929377383' as const
const MANAGER_ADDR = '0x52a859FF891167785c2DfB5Bda47aA2290fd204C' as const
const RPC          = 'https://ethereum-sepolia-rpc.publicnode.com'

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function delegates(address) view returns (address)',
  'function delegate(address) nonpayable',
  'function transfer(address, uint256) returns (bool)',
])

const AZORIUS_EVENT = parseAbiItem(
  'event ProposalCreated(address strategy, uint256 proposalId, address proposer, (address to, uint256 value, bytes data, uint8 operation)[] transactions, string metadata)',
)

test.describe.configure({ mode: 'serial' })

test.describe('Azorius DAO Proposal E2E (Sepolia)', () => {
  // one-time chain setup (runs before the first test)
  test.beforeAll(async () => {
    const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`
    const account = privateKeyToAccount(PRIVATE_KEY)
    const walletClient = createWalletClient({ account, chain: SEPOLIA_CHAIN, transport: http(RPC) })
    const publicClient = createPublicClient({ chain: SEPOLIA_CHAIN, transport: http(RPC) })

    // 1. Self-delegate VTT so the deployer has voting power (isProposer check)
    const currentDelegate = await publicClient.readContract({
      address: VTT_TOKEN, abi: ERC20_ABI, functionName: 'delegates', args: [account.address],
    }) as `0x${string}`

    if (currentDelegate.toLowerCase() !== account.address.toLowerCase()) {
      console.log('  [setup] Self-delegating VTT...')
      const h = await walletClient.writeContract({
        address: VTT_TOKEN, abi: ERC20_ABI, functionName: 'delegate', args: [account.address],
      })
      await publicClient.waitForTransactionReceipt({ hash: h, timeout: 90_000 })
      console.log('  [setup] VTT delegated')
    } else {
      console.log('  [setup] VTT already delegated')
    }

    // 2. Ensure DAO treasury holds enough GVT for the vesting (>= 1000 GVT)
    const safeGVT = await publicClient.readContract({
      address: GVT_TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [DAO_SAFE],
    }) as bigint
    const NEEDED = 1_000n * 10n ** 18n

    if (safeGVT < NEEDED) {
      console.log(`  [setup] Sending GVT to DAO Safe (current: ${safeGVT})...`)
      const h = await walletClient.writeContract({
        address: GVT_TOKEN, abi: ERC20_ABI, functionName: 'transfer', args: [DAO_SAFE, NEEDED],
      })
      await publicClient.waitForTransactionReceipt({ hash: h, timeout: 90_000 })
      console.log('  [setup] GVT sent')
    } else {
      console.log(`  [setup] DAO Safe has ${safeGVT} GVT`)
    }
  })

  test.beforeEach(async ({ page }) => {
    await injectWallet(page)
    await page.goto('http://localhost:5173?testMode=1')
    await expect(
      page.getByText(TEST_ADDRESS.slice(0, 6), { exact: false }),
    ).toBeVisible({ timeout: 30_000 })
  })

  test('T6: submit vesting proposal via Azorius DAO (on-chain metadata)', async ({ page }) => {
    test.setTimeout(180_000)

    const publicClient = createPublicClient({ chain: SEPOLIA_CHAIN, transport: http(RPC) })

    // 0. Record current block for event filtering
    const blockBefore = await publicClient.getBlockNumber()
    console.log(`Block before test: ${blockBefore}`)

    // 1. Navigate to Create Vesting -> DAO mode
    await page.getByRole('button', { name: 'Create Vesting' }).click()
    await page.getByRole('button', { name: /Via Decent DAO/i }).click()
    await expect(page.getByText(DAO_SAFE, { exact: false })).toBeVisible({ timeout: 10_000 })

    // 2. Wait for DAO treasury GVT balance to appear
    const daoPanel = page.locator('text=Decent DAO Treasury').locator('../..')
    await expect(daoPanel).toBeVisible({ timeout: 10_000 })
    await expect(daoPanel.getByText('...')).not.toBeVisible({ timeout: 30_000 })
    const balanceText = await daoPanel.locator('[style*="font-weight: bold"]').last().textContent()
    console.log(`DAO treasury GVT balance: ${balanceText}`)

    // 3. Fill the vesting form
    await page.getByPlaceholder('0x...').fill(TEST_ADDRESS)
    await page.getByPlaceholder('1000').fill('50')
    await page.locator('input[type="number"][min="1"][max="65535"]').fill('4')
    await page.locator('input[type="datetime-local"]').fill(new Date().toISOString().slice(0, 16))

    // 4. Fill proposal title and description
    const TEST_TITLE = `E2E vesting proposal ${Date.now()}`
    const TEST_DESC  = 'Automated E2E: vest 50 GVT over 4 weeks via Azorius'
    await page.getByTestId('proposal-title').fill(TEST_TITLE)
    await page.getByTestId('proposal-description').fill(TEST_DESC)

    // 5. Verify Propose button is enabled
    const proposeBtn = page.getByRole('button', { name: /Propose to Decent DAO/i })
    await expect(proposeBtn).toBeEnabled({ timeout: 15_000 })

    // 6. Click Propose -- wallet fixture handles eth_sendTransaction
    //    The mock wallet signs and broadcasts the submitProposal tx on Sepolia
    await proposeBtn.click()

    // 7. Wait for success banner (tx mines on Sepolia, ~12-60 s)
    await expect(page.getByText('Proposal submitted to Decent DAO', { exact: false }))
      .toBeVisible({ timeout: 120_000 })
    console.log('Proposal submitted (UI success banner)')

    // 8. Verify the "View on Decent DAO" link is present
    const viewLink = page.getByRole('link', { name: /View on Decent DAO/i })
    await expect(viewLink).toBeVisible()
    const href = await viewLink.getAttribute('href')
    console.log(`Proposal URL: ${href}`)

    // 9. Query ProposalCreated event on-chain and verify metadata
    const logs = await publicClient.getLogs({
      address: AZORIUS_ADDR,
      event: AZORIUS_EVENT,
      fromBlock: blockBefore,
      toBlock: 'latest',
    })
    expect(logs.length).toBeGreaterThan(0)
    const proposalLog = logs[logs.length - 1]
    console.log(`ProposalCreated event: proposalId=${proposalLog.args.proposalId}`)

    // 10. Verify on-chain metadata contains title and description
    const onChainMetadata = JSON.parse(proposalLog.args.metadata as string) as {
      title: string; description: string; documentationUrl: string
    }
    expect(onChainMetadata.title).toBe(TEST_TITLE)
    expect(onChainMetadata.description).toBe(TEST_DESC)
    console.log(`On-chain metadata verified: title="${onChainMetadata.title}"`)

    // 11. Verify the transaction array has exactly 2 entries
    const txs = proposalLog.args.transactions as Array<{
      to: string; value: bigint; data: string; operation: number
    }>
    expect(txs).toHaveLength(2)
    // First tx: approve GVT
    expect(txs[0].to.toLowerCase()).toBe(GVT_TOKEN.toLowerCase())
    expect(txs[0].operation).toBe(0)
    // Second tx: addVesting
    expect(txs[1].to.toLowerCase()).toBe(MANAGER_ADDR.toLowerCase())
    expect(txs[1].operation).toBe(0)
    console.log(`Proposal transactions verified: approve=${txs[0].to}, addVesting=${txs[1].to}`)
    console.log(`E2E complete -- proposal #${proposalLog.args.proposalId} is live and open for voting`)
  })
})
