import { test, expect } from '@playwright/test'
import { injectWallet, TEST_ADDRESS } from './wallet-fixture'
import { createPublicClient, createWalletClient, http, parseUnits, parseEventLogs } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { defineChain } from 'viem'
import * as dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '../.env') })

const CHIADO_CHAIN = defineChain({
  id: 10200,
  name: 'Gnosis Chiado',
  nativeCurrency: { name: 'Chiado xDAI', symbol: 'xDAI', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.chiadochain.net'] } },
  testnet: true,
})

const TOKEN_ADDRESS = process.env.VITE_TOKEN_ADDRESS as `0x${string}`
const MANAGER_ADDRESS = process.env.VITE_VESTING_POOL_MANAGER as `0x${string}`
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`
const account = privateKeyToAccount(PRIVATE_KEY)

const publicClient = createPublicClient({ chain: CHIADO_CHAIN, transport: http('https://rpc.chiadochain.net') })
const walletClient = createWalletClient({ account, chain: CHIADO_CHAIN, transport: http('https://rpc.chiadochain.net') })

const TOKEN_ABI = [
  { type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'allowance', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const

const MANAGER_ABI = [
  { type: 'function', name: 'getVestingPool', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'address' }], stateMutability: 'view' },
] as const

const POOL_ABI = [
  { type: 'function', name: 'calculateVestedAmount', inputs: [{ name: 'vestingId', type: 'bytes32' }], outputs: [{ name: 'vestedAmount', type: 'uint128' }, { name: 'claimedAmount', type: 'uint128' }], stateMutability: 'view' },
  { type: 'event', name: 'AddedVesting', inputs: [{ name: 'id', type: 'bytes32', indexed: true }] },
  { type: 'function', name: 'delegateTokens', inputs: [{ name: 'delegatee', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'claimVestedTokens', inputs: [{ name: 'vestingId', type: 'bytes32' }, { name: 'beneficiary', type: 'address' }, { name: 'tokensToClaim', type: 'uint128' }], outputs: [], stateMutability: 'nonpayable' },
] as const

// ─── helpers ────────────────────────────────────────────────────────────────

async function getOrCreateApproval(minAmount: bigint) {
  const allowance = await publicClient.readContract({
    address: TOKEN_ADDRESS, abi: TOKEN_ABI, functionName: 'allowance',
    args: [TEST_ADDRESS, MANAGER_ADDRESS],
  })
  if (allowance >= minAmount) return null
  const hash = await walletClient.writeContract({
    address: TOKEN_ADDRESS, abi: TOKEN_ABI, functionName: 'approve',
    args: [MANAGER_ADDRESS, minAmount * 10n], // approve 10× for repeated runs
  })
  return publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 })
}

async function getVestingPool(): Promise<`0x${string}` | null> {
  try {
    return await publicClient.readContract({
      address: MANAGER_ADDRESS, abi: MANAGER_ABI, functionName: 'getVestingPool',
      args: [TEST_ADDRESS],
    })
  } catch { return null }
}

// ─── shared state across serial tests ────────────────────────────────────────

let sharedVestingId: `0x${string}` | null = null

// ─── tests ────────────────────────────────────────────────────────────────────

test.describe.configure({ mode: 'serial' })

test.describe('Vesting Dashboard E2E (Gnosis Chiado)', () => {

  test.beforeEach(async ({ page }) => {
    await injectWallet(page)
    await page.goto('http://localhost:5173?testMode=1')
    // Wait for wallet auto-connect: address shown in header
    await expect(page.getByText(TEST_ADDRESS.slice(0, 6), { exact: false })).toBeVisible({
      timeout: 30_000,
    })
  })

  // ── T1: Connect & show header ──────────────────────────────────────────────
  test('T1: wallet connects and shows address', async ({ page }) => {
    const header = page.locator('header')
    await expect(header).toContainText('Gnosis Chiado', { timeout: 10_000 })
    await expect(header.getByText(TEST_ADDRESS.slice(0, 6), { exact: false })).toBeVisible()
  })

  // ── T2: Create a linear vesting (start 2 weeks ago → tokens already vesting)
  test('T2: create linear vesting via UI', async ({ page }) => {
    test.setTimeout(180_000)

    // Pre-approve directly so we skip the approve step in UI
    const amount = parseUnits('100', 18)
    await getOrCreateApproval(amount)

    // Switch to Create tab
    await page.getByRole('button', { name: 'Create Vesting' }).click()

    // Fill recipient (self)
    const recipientInput = page.getByPlaceholder('0x...')
    await recipientInput.fill(TEST_ADDRESS)

    // Amount
    await page.getByPlaceholder('1000').fill('100')
    // Duration 52 weeks
    const durationInput = page.locator('input[type="number"][min="1"][max="65535"]')
    await durationInput.fill('52')

    // Start date: 2 weeks ago (tokens already streaming)
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000)
    const localIso = twoWeeksAgo.toISOString().slice(0, 16)
    const startInput = page.locator('input[type="datetime-local"]')
    await startInput.fill(localIso)

    // Choose Linear (already selected by default)
    await expect(page.getByRole('button', { name: 'Linear' })).toHaveClass(/bg-blue-600/)

    // Click create (no approve needed – pre-approved above)
    const createBtn = page.getByRole('button', { name: 'Create Vesting' }).nth(1)
    await expect(createBtn).toBeEnabled({ timeout: 10_000 })
    await createBtn.click()

    // Wait for confirmation (Chiado block ~5s)
    const vestingIdEl = page.getByTestId('vesting-id')
    await expect(vestingIdEl).toBeVisible({ timeout: 120_000 })

    sharedVestingId = (await vestingIdEl.innerText()).trim() as `0x${string}`
    expect(sharedVestingId).toMatch(/^0x[0-9a-fA-F]{64}$/)
  })

  // ── T3: View vesting in "My Vestings" ─────────────────────────────────────
  test('T3: view vesting in My Vestings tab', async ({ page }) => {
    test.setTimeout(60_000)
    expect(sharedVestingId).toBeTruthy()

    await page.getByRole('button', { name: 'My Vestings' }).click()

    // Paste the vesting ID
    const idInput = page.getByPlaceholder('0x…').last()
    await idInput.fill(sharedVestingId!)
    await page.getByRole('button', { name: 'Track' }).click()

    // Card should appear with total 100 GVT
    await expect(page.getByText('100 GVT').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Linear')).toBeVisible()
  })

  // ── T4: Delegate voting power from the VestingPool ────────────────────────
  test('T4: delegate votes from VestingPool', async ({ page }) => {
    test.setTimeout(120_000)

    await page.getByRole('button', { name: 'Delegate Votes' }).click()

    // Pool address should be visible
    const poolAddress = await getVestingPool()
    expect(poolAddress).toBeTruthy()
    await expect(page.getByText(poolAddress!.slice(0, 10), { exact: false })).toBeVisible({ timeout: 15_000 })

    // Self-delegate
    await page.getByRole('button', { name: 'Self-delegate' }).click()
    const delegateBtn = page.getByRole('button', { name: 'Delegate Voting Power' })
    await expect(delegateBtn).toBeEnabled()
    await delegateBtn.click()

    await expect(page.getByText('Delegation updated', { exact: false })).toBeVisible({ timeout: 120_000 })
  })

  // ── T5: Claim vested tokens ───────────────────────────────────────────────
  test('T5: claim vested tokens from pool', async ({ page }) => {
    test.setTimeout(180_000)
    expect(sharedVestingId).toBeTruthy()

    // Capture browser errors for debugging
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') pageErrors.push(msg.text())
    })

    await page.getByRole('button', { name: 'My Vestings' }).click()

    const idInput = page.getByPlaceholder('0x…').last()
    await idInput.fill(sharedVestingId!)
    await page.getByRole('button', { name: 'Track' }).click()

    // Card should show a Claim button (tokens have been streaming for 2 weeks)
    const claimBtn = page.locator('button', { hasText: /claim/i }).first()
    await expect(claimBtn).toBeVisible({ timeout: 30_000 })
    await expect(claimBtn).toBeEnabled()
    await claimBtn.click()

    // Wait for success OR error message
    const successEl = page.getByTestId('claim-success')
    const errorEl = page.getByTestId('claim-error')
    await expect(successEl.or(errorEl)).toBeVisible({ timeout: 120_000 })

    // If error appeared, fail with descriptive message
    if (await errorEl.isVisible()) {
      const errMsg = await errorEl.textContent()
      throw new Error(`Claim failed: ${errMsg}`)
    }

    await expect(page.getByText('Tokens claimed successfully', { exact: false })).toBeVisible()
    if (pageErrors.length > 0) console.log('Page errors:', pageErrors.join('\n'))
  })

})
