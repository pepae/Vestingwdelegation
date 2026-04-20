import type { Page } from '@playwright/test'
import { createWalletClient, createPublicClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { defineChain } from 'viem'

export const SEPOLIA_CHAIN = defineChain({
  id: 11155111,
  name: 'Sepolia',
  nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://ethereum-sepolia-rpc.publicnode.com'] } },
  testnet: true,
})

const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com'
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`
const account = privateKeyToAccount(PRIVATE_KEY)

export const TEST_ADDRESS = account.address

const walletClient = createWalletClient({
  account,
  chain: SEPOLIA_CHAIN,
  transport: http(SEPOLIA_RPC),
})

const publicClient = createPublicClient({
  chain: SEPOLIA_CHAIN,
  transport: http(SEPOLIA_RPC),
})

/** Handle an EIP-1193 request from the injected window.ethereum. */
export async function handleEthRequest(
  method: string,
  params: unknown[],
): Promise<unknown> {
  switch (method) {
    case 'eth_requestAccounts':
    case 'eth_accounts':
      return [TEST_ADDRESS]

    case 'eth_chainId':
      return '0xaa36a7' // 11155111

    case 'net_version':
      return '11155111'

    case 'wallet_switchEthereumChain':
    case 'wallet_addEthereumChain':
    case 'wallet_watchAsset':
      return null

    case 'eth_sendTransaction': {
      const tx = params[0] as Record<string, string>
      const hash = await walletClient.sendTransaction({
        to: tx.to as `0x${string}`,
        data: tx.data as `0x${string}` | undefined,
        value: tx.value ? BigInt(tx.value) : undefined,
        gas: tx.gas ? BigInt(tx.gas) : undefined,
      })
      return hash
    }

    case 'personal_sign': {
      const [data] = params as [string, string]
      const sig = await walletClient.signMessage({ message: { raw: data as `0x${string}` } })
      return sig
    }

    case 'eth_signTypedData_v4': {
      const [, typedDataStr] = params as [string, string]
      const td = JSON.parse(typedDataStr)
      const { EIP712Domain: _domain, ...types } = td.types as Record<string, unknown>
      const sig = await walletClient.signTypedData({
        domain: td.domain,
        types: types as Parameters<typeof walletClient.signTypedData>[0]['types'],
        primaryType: td.primaryType,
        message: td.message,
      })
      return sig
    }

    default: {
      // Forward read-only calls to the RPC
      const resp = await fetch(SEPOLIA_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })
      const json = (await resp.json()) as { result: unknown; error?: { message: string } }
      if (json.error) throw new Error(json.error.message)
      return json.result
    }
  }
}

/**
 * Inject a mock window.ethereum provider into the page, backed by the
 * test private key via Playwright's exposeFunction bridge.
 */
export async function injectWallet(page: Page) {
  // Bridge: browser calls window.__ethRelay(method, params) → Node.js signs/sends
  await page.exposeFunction('__ethRelay', (method: string, params: unknown[]) =>
    handleEthRequest(method, params),
  )

  await page.addInitScript(() => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {}

    ;(window as unknown as Record<string, unknown>).ethereum = {
      isMetaMask: true,
      selectedAddress: null as string | null,

      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (window as any).__ethRelay(method, params ?? [])
        if (method === 'eth_requestAccounts' && Array.isArray(result) && result[0]) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(window as any).ethereum.selectedAddress = result[0]
          ;(listeners['accountsChanged'] ?? []).forEach((fn) => fn(result))
        }
        return result
      },

      on(event: string, fn: (...args: unknown[]) => void) {
        listeners[event] = listeners[event] ?? []
        listeners[event].push(fn)
      },

      removeListener(event: string, fn: (...args: unknown[]) => void) {
        listeners[event] = (listeners[event] ?? []).filter((h) => h !== fn)
      },
    }
  })
}

/** Wait for a transaction to be mined on Chiado (~5-15 s blocks). */
export async function waitForReceipt(hash: `0x${string}`) {
  return publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 })
}
