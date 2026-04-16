import { useEffect } from 'react'
import { useConnect, useAccount } from 'wagmi'

/**
 * When the URL contains ?testMode=1, automatically connect with the injected
 * wallet (window.ethereum). Playwright injects a mock provider before the page
 * loads, so this is what the test wallet will be picked up as.
 */
export function useAutoConnect() {
  const { connect, connectors } = useConnect()
  const { isConnected } = useAccount()

  useEffect(() => {
    if (isConnected) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('testMode') !== '1') return

    const injected = connectors.find((c) => c.type === 'injected')
    if (!injected) return
    connect({ connector: injected })
  }, [connectors, isConnected, connect])
}
