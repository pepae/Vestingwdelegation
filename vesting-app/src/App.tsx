import { useAccount } from 'wagmi'
import { useState, useEffect } from 'react'
import CreateVesting from './components/CreateVesting'
import VestingList from './components/VestingList'
import DelegatePanel from './components/DelegatePanel'
import ConnectButton from './components/ConnectButton'
import FaucetButton from './components/FaucetButton'
import { useAutoConnect } from './hooks/useAutoConnect'

type Tab = 'vestings' | 'create' | 'delegate'

const LS_KEY = 'trackedVestingIds'

export default function App() {
  useAutoConnect()
  const { isConnected } = useAccount()
  const [activeTab, setActiveTab] = useState<Tab>('vestings')

  const [trackedIds, setTrackedIds] = useState<`0x${string}`[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as `0x${string}`[]
    } catch {
      return []
    }
  })

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(trackedIds))
  }, [trackedIds])

  function addTrackedId(id: `0x${string}`) {
    setTrackedIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
    // Delay tab switch so tests (and users) can read the vesting ID before it disappears
    setTimeout(() => setActiveTab('vestings'), 4000)
  }

  function removeTrackedId(id: `0x${string}`) {
    setTrackedIds((prev) => prev.filter((v) => v !== id))
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Bauhaus accent bar */}
      <div style={{ height: '5px', background: 'var(--accent)' }} />

      {/* Header */}
      <header style={{ background: 'var(--surface)', borderBottom: '2px solid var(--border)' }}>
        <div style={{ maxWidth: '960px', margin: '0 auto', padding: '0 1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '64px' }}>

            {/* Wordmark */}
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.375rem' }}>
                <span className="vd-title" style={{ fontSize: '1.125rem' }}>Vesting</span>
                <span style={{
                  fontFamily: "'Arial Black', Arial, sans-serif",
                  fontSize: '1rem',
                  fontWeight: 900,
                  color: 'var(--accent)',
                  lineHeight: 1,
                }}>◆</span>
                <span className="vd-title" style={{ fontSize: '1.125rem' }}>Dashboard</span>
              </div>
              <div className="vd-sub" style={{ fontSize: '0.625rem', marginTop: '0.125rem', letterSpacing: '0.06em' }}>
                Sepolia Testnet
              </div>
            </div>

            {/* Header actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
              {isConnected && <FaucetButton />}
              {isConnected && (
                <a
                  href="https://sepoliafaucet.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="vd-btn vd-btn-ghost"
                  style={{ fontSize: '0.6875rem', padding: '0.375rem 0.625rem', textDecoration: 'none' }}
                  title="Get free Chiado xDAI for gas"
                >
                  xDAI Faucet ↗
                </a>
              )}
              <ConnectButton />
            </div>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: '960px', margin: '0 auto', padding: '0 1.5rem' }}>
        {!isConnected ? (
          <div style={{ textAlign: 'center', paddingTop: '7rem', paddingBottom: '7rem' }}>
            <div className="vd-title" style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>
              Connect Wallet
            </div>
            <div className="vd-sub" style={{ fontSize: '0.9375rem' }}>
              Switch to Gnosis Chiado (chain 10200) after connecting
            </div>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="vd-tab-bar" style={{ marginTop: '2rem' }}>
              {(['vestings', 'create', 'delegate'] as Tab[]).map((tab) => (
                <button
                  key={tab}
                  className={`vd-tab${activeTab === tab ? ' vd-on' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === 'vestings' ? 'My Vestings' : tab === 'create' ? 'Create Vesting' : 'Delegate Votes'}
                </button>
              ))}
            </div>

            {/* Content */}
            <div style={{ paddingTop: '2rem', paddingBottom: '4rem' }}>
              {activeTab === 'vestings' && <VestingList trackedIds={trackedIds} onAddId={addTrackedId} onRemoveId={removeTrackedId} />}
              {activeTab === 'create' && <CreateVesting onVestingCreated={addTrackedId} />}
              {activeTab === 'delegate' && <DelegatePanel />}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
