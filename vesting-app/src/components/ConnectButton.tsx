import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { SEPOLIA_EXPLORER_URL } from '../contracts'

export default function ConnectButton() {
  const { address, isConnected, chain } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()

  if (isConnected && address) {
    const wrongChain = chain?.id !== 11155111
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {wrongChain && (
          <span className="vd-badge" style={{ color: '#C67A00', borderColor: '#C67A00' }}>
            Wrong network
          </span>
        )}
        <a
          href={`${SEPOLIA_EXPLORER_URL}/address/${address}`}
          target="_blank"
          rel="noreferrer"
          data-testid="connected-address"
          className="vd-btn vd-btn-outline"
          style={{ fontFamily: "'Courier New', Courier, monospace", letterSpacing: '0.02em', fontSize: '0.75rem' }}
        >
          {address.slice(0, 6)}…{address.slice(-4)}
        </a>
        <button className="vd-btn vd-btn-ghost" onClick={() => disconnect()} title="Disconnect">
          ✕
        </button>
      </div>
    )
  }

  const injected = connectors[0]
  return (
    <button
      data-testid="connect-button"
      className="vd-btn vd-btn-dark"
      onClick={() => connect({ connector: injected })}
      disabled={isPending}
    >
      {isPending ? 'Connecting…' : 'Connect Wallet'}
    </button>
  )
}
