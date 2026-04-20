/**
 * E2E test: Propose vesting via Decent DAO (Safe multisig) on Sepolia
 *
 * Uses the same wallet fixture as vesting.spec.ts — the deployer key
 * (0x2da5d86b...) is a real Safe owner on 0x09D6...8eeD so the proposal
 * is submitted to the actual Safe Transaction Service and visible in the
 * Decent DAO UI.
 */
import { test, expect } from '@playwright/test'
import { injectWallet, TEST_ADDRESS } from './wallet-fixture'
import * as dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '../.env') })

const SAFE_ADDRESS = '0x09D6b08aE680d159656bE25415B80381D69b8eeD'
const SAFE_API = 'https://api.safe.global/tx-service/sep/api/v1'
const DECENT_DAO_URL = `https://app.decentdao.org/home?dao=sep:${SAFE_ADDRESS}`

test.describe.configure({ mode: 'serial' })

test.describe('DAO Proposal E2E (Sepolia)', () => {
  test.beforeEach(async ({ page }) => {
    await injectWallet(page)
    await page.goto('http://localhost:5173?testMode=1')
    await expect(
      page.getByText(TEST_ADDRESS.slice(0, 6), { exact: false }),
    ).toBeVisible({ timeout: 30_000 })
  })

  test('T6: propose vesting to Decent DAO via Safe multisig', async ({ page }) => {
    test.setTimeout(120_000)

    // ── 1. Capture Safe nonce BEFORE the test so we can verify afterwards ──
    const nonceResBefore = await fetch(`${SAFE_API}/safes/${SAFE_ADDRESS}/`)
    const safeBefore = await nonceResBefore.json() as { nonce: number }
    const nonceBefore = safeBefore.nonce
    console.log(`Safe nonce before: ${nonceBefore}`)

    // ── 2. Navigate to Create Vesting tab ────────────────────────────────
    await page.getByRole('button', { name: 'Create Vesting' }).click()

    // ── 3. Switch to DAO mode ─────────────────────────────────────────────
    await page.getByRole('button', { name: /Via Decent DAO/i }).click()

    // DAO treasury panel should appear
    await expect(page.getByText(SAFE_ADDRESS, { exact: false })).toBeVisible({ timeout: 10_000 })

    // ── 4. Wait for DAO treasury balance to resolve (changes from "…" to a number) ──
    const daoPanel = page.locator('text=Decent DAO Treasury').locator('../..')
    await expect(daoPanel).toBeVisible({ timeout: 10_000 })
    // "…" is the loading placeholder — wait for it to go away
    await expect(daoPanel.getByText('…')).not.toBeVisible({ timeout: 30_000 })
    const balanceText = await daoPanel.locator('[style*="font-weight: bold"]').last().textContent()
    console.log(`DAO treasury balance: ${balanceText}`)

    // ── 5. Fill the form ───────────────────────────────────────────────────
    // Recipient: self
    const recipientInput = page.getByPlaceholder('0x...')
    await recipientInput.fill(TEST_ADDRESS)

    // Amount: 50 GVT (well within the 10k DAO treasury)
    await page.getByPlaceholder('1000').fill('50')

    // Duration: 4 weeks
    const durationInput = page.locator('input[type="number"][min="1"][max="65535"]')
    await durationInput.fill('4')

    // Start date: now
    const startInput = page.locator('input[type="datetime-local"]')
    await startInput.fill(new Date().toISOString().slice(0, 16))

    // ── 6. Verify the Propose button is enabled (no daoNeedsTokens) ───────
    const proposeBtn = page.getByRole('button', { name: /Propose to Decent DAO/i })
    await expect(proposeBtn).toBeVisible({ timeout: 10_000 })
    await expect(proposeBtn).toBeEnabled({ timeout: 15_000 })

    // ── 7. Intercept the Safe API POST to capture the response ────────────
    let safeApiStatus: number | null = null
    let safeApiBody: string | null = null
    await page.route(`${SAFE_API}/safes/${SAFE_ADDRESS}/multisig-transactions/`, async (route) => {
      // Let the request through but capture the response
      const response = await route.fetch()
      safeApiStatus = response.status()
      safeApiBody = await response.text()
      console.log(`Safe API response: ${safeApiStatus}`)
      if (safeApiBody) console.log(`Safe API body: ${safeApiBody.slice(0, 300)}`)
      await route.fulfill({ response })
    })

    // ── 8. Click Propose — wallet fixture auto-signs the EIP-712 request ──
    await proposeBtn.click()

    // "Sign in wallet…" state should flash briefly
    await expect(page.getByText(/Sign in wallet/i).or(page.getByText(/Submitting to Safe/i)))
      .toBeVisible({ timeout: 15_000 })
      .catch(() => { /* may be too fast to catch */ })

    // ── 9. Wait for success banner ────────────────────────────────────────
    const successBanner = page.getByText('Proposal submitted to Decent DAO', { exact: false })
    await expect(successBanner).toBeVisible({ timeout: 60_000 })
    console.log('✓ Success banner visible')

    // ── 10. Verify the "View & Execute" link points to Decent DAO ─────────
    const viewLink = page.getByRole('link', { name: /View.*Execute.*Decent DAO/i })
    await expect(viewLink).toBeVisible()
    const href = await viewLink.getAttribute('href')
    expect(href).toMatch(/app\.decentdao\.org\/proposals\/0x[0-9a-fA-F]{64}/)
    console.log(`Proposal URL: ${href}`)

    // ── 11. Verify via Safe API using the specific tx hash from the proposal URL ─
    expect(safeApiStatus).toBe(201)
    console.log(`Safe API status: ${safeApiStatus} ✓`)

    // Extract the 32-byte tx hash from the Decent DAO proposal URL
    const txHash = href!.match(/0x[0-9a-fA-F]{64}/)?.[0]
    expect(txHash).toBeTruthy()

    // Query Safe TX Service directly for this transaction
    const txRes = await fetch(`${SAFE_API}/multisig-transactions/${txHash}/`)
    expect(txRes.ok).toBe(true)
    const txData = await txRes.json() as { nonce: number; isExecuted: boolean; safeTxHash: string; confirmations: unknown[] }
    expect(txData.isExecuted).toBe(false)
    expect(txData.nonce).toBe(Number(nonceBefore))
    console.log(`✓ Pending proposal confirmed in Safe API: nonce=${txData.nonce} confirmations=${txData.confirmations.length}`)

    // ── 12. Print the Decent DAO link for manual confirmation ─────────────
    console.log(`\n🎉 Proposal live on Decent DAO:`)
    console.log(`   ${href}`)
    console.log(`   Or browse the DAO: ${DECENT_DAO_URL}`)
  })
})
