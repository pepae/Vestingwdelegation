/**
 * E2E test: Propose vesting via Decent DAO (Safe multisig) on Sepolia
 *
 * Full lifecycle:
 *   1. UI proposes the vesting → Safe API (201)
 *   2. Test executes it on-chain (threshold=1, deployer is owner+signer)
 *   3. Asserts the vesting exists in VestingPoolManager
 */
import { test, expect } from '@playwright/test'
import { injectWallet, TEST_ADDRESS, SEPOLIA_CHAIN } from './wallet-fixture'
import { createWalletClient, createPublicClient, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '../.env') })

const SAFE_ADDRESS   = '0x09D6b08aE680d159656bE25415B80381D69b8eeD' as const
const MANAGER_ADDRESS = '0x52a859FF891167785c2DfB5Bda47aA2290fd204C' as const
const SAFE_API       = 'https://api.safe.global/tx-service/sep/api/v1'
const RPC            = 'https://ethereum-sepolia-rpc.publicnode.com'

const SAFE_EXEC_ABI = parseAbi([
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) returns (bool)',
])

const MANAGER_ABI = parseAbi([
  'function getVestingPool(address user) view returns (address)',
])

const POOL_ABI = parseAbi([
  'function totalTokensInVesting() view returns (uint256)',
])

test.describe.configure({ mode: 'serial' })

test.describe('DAO Proposal E2E (Sepolia)', () => {
  test.beforeEach(async ({ page }) => {
    await injectWallet(page)
    await page.goto('http://localhost:5173?testMode=1')
    await expect(
      page.getByText(TEST_ADDRESS.slice(0, 6), { exact: false }),
    ).toBeVisible({ timeout: 30_000 })
  })

  test('T6: propose → execute vesting via Safe multisig (full E2E)', async ({ page }) => {
    test.setTimeout(180_000)

    // ── 0. Viem clients for on-chain execution ────────────────────────────
    const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`
    const account = privateKeyToAccount(PRIVATE_KEY)
    const walletClient = createWalletClient({ account, chain: SEPOLIA_CHAIN, transport: http(RPC) })
    const publicClient = createPublicClient({ chain: SEPOLIA_CHAIN, transport: http(RPC) })

    // ── 1. Capture Safe nonce BEFORE the test ────────────────────────────
    const nonceBefore: number = await fetch(`${SAFE_API}/safes/${SAFE_ADDRESS}/`)
      .then(r => r.json()).then((d: { nonce: number }) => d.nonce)
    console.log(`Safe nonce before: ${nonceBefore}`)

    // Snapshot vesting count for the recipient so we can detect the new one
    const poolBefore = await publicClient.readContract({
      address: MANAGER_ADDRESS, abi: MANAGER_ABI, functionName: 'getVestingPool', args: [TEST_ADDRESS as `0x${string}`],
    }) as `0x${string}`
    const countBefore = poolBefore === '0x0000000000000000000000000000000000000000' ? 0n :
      await publicClient.readContract({ address: poolBefore, abi: POOL_ABI, functionName: 'totalTokensInVesting' }) as bigint
    console.log(`totalTokensInVesting before: ${countBefore} (pool: ${poolBefore})`)

    // ── 2. Navigate to Create Vesting → DAO mode ─────────────────────────
    await page.getByRole('button', { name: 'Create Vesting' }).click()
    await page.getByRole('button', { name: /Via Decent DAO/i }).click()
    await expect(page.getByText(SAFE_ADDRESS, { exact: false })).toBeVisible({ timeout: 10_000 })

    // ── 3. Wait for DAO treasury balance to resolve ───────────────────────
    const daoPanel = page.locator('text=Decent DAO Treasury').locator('../..')
    await expect(daoPanel).toBeVisible({ timeout: 10_000 })
    await expect(daoPanel.getByText('…')).not.toBeVisible({ timeout: 30_000 })
    const balanceText = await daoPanel.locator('[style*="font-weight: bold"]').last().textContent()
    console.log(`DAO treasury balance: ${balanceText}`)

    // ── 4. Fill the form ──────────────────────────────────────────────────
    await page.getByPlaceholder('0x...').fill(TEST_ADDRESS)
    await page.getByPlaceholder('1000').fill('50')
    await page.locator('input[type="number"][min="1"][max="65535"]').fill('4')
    await page.locator('input[type="datetime-local"]').fill(new Date().toISOString().slice(0, 16))

    // ── 5. Verify Propose button is enabled ──────────────────────────────
    const proposeBtn = page.getByRole('button', { name: /Propose to Decent DAO/i })
    await expect(proposeBtn).toBeEnabled({ timeout: 15_000 })

    // ── 6. Intercept Safe API POST to capture HTTP status ─────────────────
    let safeApiStatus: number | null = null
    await page.route(`${SAFE_API}/safes/${SAFE_ADDRESS}/multisig-transactions/`, async (route) => {
      const response = await route.fetch()
      safeApiStatus = response.status()
      console.log(`Safe API response: ${safeApiStatus}`)
      await route.fulfill({ response })
    })

    // ── 7. Click Propose — wallet fixture auto-signs EIP-712 ─────────────
    await proposeBtn.click()

    // ── 8. Wait for success banner ────────────────────────────────────────
    await expect(page.getByText('Proposal submitted to Decent DAO', { exact: false }))
      .toBeVisible({ timeout: 60_000 })
    console.log('✓ Proposal submitted (UI)')

    // ── 9. Extract safeTxHash from the Decent DAO proposal link ──────────
    const viewLink = page.getByRole('link', { name: /View.*Execute.*Decent DAO/i })
    await expect(viewLink).toBeVisible()
    const href = await viewLink.getAttribute('href')
    expect(href).toMatch(/app\.decentdao\.org\/proposals\/0x[0-9a-fA-F]{64}/)
    const safeTxHash = href!.match(/0x[0-9a-fA-F]{64}/)?.[0]!
    console.log(`safeTxHash: ${safeTxHash}`)

    // ── 10. Sanity: Safe API accepted the proposal ────────────────────────
    expect(safeApiStatus).toBe(201)

    // ── 11. Fetch full tx details from Safe API (includes signatures) ─────
    const txDetails = await fetch(`${SAFE_API}/multisig-transactions/${safeTxHash}/`)
      .then(r => r.json()) as {
        to: string; value: string; data: string | null; operation: number
        safeTxGas: string; baseGas: string; gasPrice: string
        gasToken: string; refundReceiver: string; signatures: string | null
        nonce: number; isExecuted: boolean
        confirmations: Array<{ owner: string; signature: string }>
      }
    expect(txDetails.isExecuted).toBe(false)
    expect(txDetails.nonce).toBe(Number(nonceBefore))
    console.log(`✓ Tx confirmed in Safe API (nonce=${txDetails.nonce}, not yet executed)`)

    // Build concatenated signatures from confirmations array (top-level .signatures may be null
    // for newly submitted txs that haven't been relayed yet)
    const signaturesHex = (txDetails.signatures ??
      txDetails.confirmations.map(c => c.signature).join('')) as `0x${string}`
    expect(signaturesHex).toBeTruthy()

    // ── 12. Execute the Safe transaction on-chain ─────────────────────────
    // Deployer is a Safe owner; threshold=1 → one sig is enough to execute
    console.log('Sending execTransaction...')
    const execHash = await walletClient.writeContract({
      address: SAFE_ADDRESS,
      abi: SAFE_EXEC_ABI,
      functionName: 'execTransaction',
      args: [
        txDetails.to as `0x${string}`,
        BigInt(txDetails.value),
        (txDetails.data ?? '0x') as `0x${string}`,
        txDetails.operation,
        BigInt(txDetails.safeTxGas),
        BigInt(txDetails.baseGas),
        BigInt(txDetails.gasPrice),
        txDetails.gasToken as `0x${string}`,
        txDetails.refundReceiver as `0x${string}`,
        signaturesHex,
      ],
    })
    console.log(`execTransaction submitted: ${execHash}`)

    // ── 13. Wait for the execution receipt ───────────────────────────────
    const receipt = await publicClient.waitForTransactionReceipt({ hash: execHash, timeout: 60_000 })
    expect(receipt.status).toBe('success')
    console.log(`✓ execTransaction mined in block ${receipt.blockNumber}`)

    // ── 14. Confirm Safe API marks the tx as executed ─────────────────────
    // Safe API indexer may lag a few seconds
    let executed = false
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 5_000))
      const check = await fetch(`${SAFE_API}/multisig-transactions/${safeTxHash}/`)
        .then(r => r.json()) as { isExecuted: boolean; transactionHash: string }
      if (check.isExecuted) {
        console.log(`✓ Safe API marks tx as executed (onchain hash: ${check.transactionHash})`)
        executed = true
        break
      }
    }
    expect(executed).toBe(true)

    // ── 15. Verify the vesting was actually created on-chain ──────────────
    const poolAfter = await publicClient.readContract({
      address: MANAGER_ADDRESS, abi: MANAGER_ABI, functionName: 'getVestingPool', args: [TEST_ADDRESS as `0x${string}`],
    }) as `0x${string}`
    expect(poolAfter).not.toBe('0x0000000000000000000000000000000000000000')
    const countAfter = await publicClient.readContract({
      address: poolAfter, abi: POOL_ABI, functionName: 'totalTokensInVesting',
    }) as bigint
    expect(countAfter).toBeGreaterThan(countBefore)
    console.log(`✓ Vesting created! totalTokensInVesting: ${countBefore} → ${countAfter} (pool: ${poolAfter})`)
  })
})
