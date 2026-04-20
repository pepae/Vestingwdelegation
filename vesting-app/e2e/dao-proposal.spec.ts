/**
 * E2E test: Propose vesting via Decent DAO (Safe multisig) on Sepolia
 *
 * Full lifecycle:
 *   1. UI proposes the vesting → Safe API (201)
 *   2. Test verifies the MultiSend contains 3 txs: approve + addVesting + metadata
 *   3. Test executes it on-chain (threshold=1, deployer is owner+signer)
 *   4. Asserts the vesting exists in VestingPoolManager
 */
import { test, expect } from '@playwright/test'
import { injectWallet, TEST_ADDRESS, SEPOLIA_CHAIN } from './wallet-fixture'
import { createWalletClient, createPublicClient, http, parseAbi, decodeAbiParameters } from 'viem'
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
const DECENT_METADATA_ADDR = '0xdA00000000000000000000000000000000000Da0'
// Fake IPFS CID returned by the mocked Pinata API during E2E tests
const MOCK_IPFS_CID = 'QmE2ETestMockCIDForVestingProposalMetadata1234567'

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

    // ── 5. Fill proposal metadata ─────────────────────────────────────────
    const TEST_TITLE = `E2E test vesting ${Date.now()}`
    const TEST_DESC  = 'Automated E2E: vest 50 GVT over 4 weeks for the deployer'
    await page.getByTestId('proposal-title').fill(TEST_TITLE)
    await page.getByTestId('proposal-description').fill(TEST_DESC)

    // ── 5. Verify Propose button is enabled ──────────────────────────────
    const proposeBtn = page.getByRole('button', { name: /Propose to Decent DAO/i })
    await expect(proposeBtn).toBeEnabled({ timeout: 15_000 })

    // ── 6. Mock Pinata IPFS upload → return fake CID ─────────────────────
    // The frontend calls Pinata when VITE_PINATA_JWT is set (even a placeholder).
    // Intercepting here lets us verify the full metadata-tx flow without real IPFS.
    let pinataRequestBody: unknown = null
    await page.route('https://api.pinata.cloud/**', async (route) => {
      const body = route.request().postDataJSON()
      pinataRequestBody = body
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ IpfsHash: MOCK_IPFS_CID }),
      })
    })

    // ── 7. Intercept Safe API POST to capture HTTP status and request body ──
    let safeApiStatus: number | null = null
    let safeApiRequestBody: Record<string, unknown> | null = null
    await page.route(`${SAFE_API}/safes/${SAFE_ADDRESS}/multisig-transactions/`, async (route) => {
      safeApiRequestBody = route.request().postDataJSON() as Record<string, unknown>
      const response = await route.fetch()
      safeApiStatus = response.status()
      console.log(`Safe API response: ${safeApiStatus}`)
      await route.fulfill({ response })
    })

    // ── 8. Click Propose — wallet fixture auto-signs EIP-712 ─────────────
    await proposeBtn.click()

    // ── 9. Wait for success banner ────────────────────────────────────────
    await expect(page.getByText('Proposal submitted to Decent DAO', { exact: false }))
      .toBeVisible({ timeout: 60_000 })
    console.log('✓ Proposal submitted (UI)')

    // ── 10. Extract safeTxHash from the Decent DAO proposal link ──────────
    const viewLink = page.getByRole('link', { name: /View.*Execute.*Decent DAO/i })
    await expect(viewLink).toBeVisible()
    const href = await viewLink.getAttribute('href')
    expect(href).toMatch(/app\.decentdao\.org\/proposals\/0x[0-9a-fA-F]{64}/)
    const safeTxHash = href!.match(/0x[0-9a-fA-F]{64}/)?.[0]!
    console.log(`safeTxHash: ${safeTxHash}`)

    // ── 11. Sanity: Safe API accepted the proposal ────────────────────────
    expect(safeApiStatus).toBe(201)

    // ── 12. Verify Pinata was called with the proposal metadata ───────────
    expect(pinataRequestBody).not.toBeNull()
    const pinataContent = (pinataRequestBody as { pinataContent: { title: string; description: string } }).pinataContent
    expect(pinataContent.title).toBe(TEST_TITLE)
    expect(pinataContent.description).toBe(TEST_DESC)
    console.log(`✓ Pinata upload intercepted: title="${pinataContent.title}"`)

    // ── 13. Verify MultiSend includes 3 txs (approve + addVesting + metadata) ──
    // Decode the Safe API request body to find the metadata tx in valueDecoded
    const safeDataDecoded = await fetch(`${SAFE_API}/data-decoder/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: safeApiRequestBody!.data, to: safeApiRequestBody!.to }),
    }).then(r => r.json()) as {
      method: string
      parameters: Array<{
        name: string
        type: string
        valueDecoded: Array<{ to: string; data: string; value: string }>
      }>
    }
    const subTxs = safeDataDecoded.parameters[0]?.valueDecoded ?? []
    expect(subTxs).toHaveLength(3)
    const metadataTx = subTxs[2]
    expect(metadataTx.to.toLowerCase()).toBe(DECENT_METADATA_ADDR.toLowerCase())
    expect(metadataTx.value).toBe('0')
    // Decode the ABI-encoded IPFS CID from the metadata tx calldata
    const [decodedCid] = decodeAbiParameters([{ type: 'string' }], metadataTx.data as `0x${string}`)
    expect(decodedCid).toBe(MOCK_IPFS_CID)
    console.log(`✓ Metadata tx verified: to=${metadataTx.to}, IPFS CID="${decodedCid}"`)

    // ── 14. Fetch full tx details from Safe API (includes signatures) ─────
    const txDetails = await fetch(`${SAFE_API}/multisig-transactions/${safeTxHash}/`)
      .then(r => r.json()) as {
        to: string; value: string; data: string | null; operation: number
        safeTxGas: string; baseGas: string; gasPrice: string
        gasToken: string; refundReceiver: string; signatures: string | null
        nonce: number; isExecuted: boolean; origin: string | null
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

    // ── 15. Execute the Safe transaction on-chain ─────────────────────────
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

    // ── 16. Wait for the execution receipt ───────────────────────────────
    const receipt = await publicClient.waitForTransactionReceipt({ hash: execHash, timeout: 60_000 })
    expect(receipt.status).toBe('success')
    console.log(`✓ execTransaction mined in block ${receipt.blockNumber}`)

    // ── 17. Confirm Safe API marks the tx as executed ─────────────────────
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

    // ── 18. Verify the vesting was actually created on-chain ──────────────
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
