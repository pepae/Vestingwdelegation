import { useAccount, useReadContract } from 'wagmi'
import { useState } from 'react'
import { formatUnits } from 'viem'
import { VESTING_POOL_ABI, TOKEN_ABI } from '../abis'
import { CONTRACT_ADDRESSES, SEPOLIA_EXPLORER_URL } from '../contracts'
import VestingCard from './VestingCard'

interface Props {
  trackedIds: `0x${string}`[]
  onAddId: (id: `0x${string}`) => void
  onRemoveId: (id: `0x${string}`) => void
}

export default function VestingList({ trackedIds, onAddId, onRemoveId }: Props) {
  const { address } = useAccount()
  const [manualVestingId, setManualVestingId] = useState('')

  const { data: poolAddress } = useReadContract({
    address: CONTRACT_ADDRESSES.vestingPoolManager,
    abi: [
      {
        type: 'function',
        name: 'getVestingPool',
        inputs: [{ name: 'user', type: 'address' }],
        outputs: [{ type: 'address' }],
        stateMutability: 'view',
      },
    ] as const,
    functionName: 'getVestingPool',
    args: [address!],
    query: { enabled: !!address && !!CONTRACT_ADDRESSES.vestingPoolManager },
  }) as { data: `0x${string}` | undefined }

  const { data: tokenSymbol } = useReadContract({
    address: CONTRACT_ADDRESSES.token,
    abi: TOKEN_ABI,
    functionName: 'symbol',
    query: { enabled: !!CONTRACT_ADDRESSES.token },
  })

  const { data: tokenDecimals } = useReadContract({
    address: CONTRACT_ADDRESSES.token,
    abi: TOKEN_ABI,
    functionName: 'decimals',
    query: { enabled: !!CONTRACT_ADDRESSES.token },
  })

  const { data: walletBalance } = useReadContract({
    address: CONTRACT_ADDRESSES.token,
    abi: TOKEN_ABI,
    functionName: 'balanceOf',
    args: [address!],
    query: { enabled: !!address && !!CONTRACT_ADDRESSES.token },
  })

  const { data: totalInVesting } = useReadContract({
    address: poolAddress,
    abi: VESTING_POOL_ABI,
    functionName: 'totalTokensInVesting',
    query: { enabled: !!poolAddress },
  })

  const { data: availableForVesting } = useReadContract({
    address: poolAddress,
    abi: VESTING_POOL_ABI,
    functionName: 'tokensAvailableForVesting',
    query: { enabled: !!poolAddress },
  })

  const decimals = (tokenDecimals as number | undefined) ?? 18
  const sym = (tokenSymbol as string | undefined) ?? ''

  function addVestingId() {
    const id = manualVestingId.trim() as `0x${string}`
    if (id && id.startsWith('0x')) {
      onAddId(id)
      setManualVestingId('')
    }
  }

  const fmtBig = (v: unknown) =>
    v !== undefined
      ? `${Number(formatUnits(v as bigint, decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${sym}`
      : '--'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* Stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', border: '2px solid var(--border)', background: 'var(--surface)' }}>
        <div className="vd-stat" style={{ borderRight: '2px solid var(--border)', padding: '1rem' }}>
          <div className="vd-stat-label">Wallet balance</div>
          <div className="vd-stat-value" style={{ fontSize: '1rem' }}>{fmtBig(walletBalance)}</div>
        </div>
        <div className="vd-stat" style={{ borderRight: '2px solid var(--border)', padding: '1rem' }}>
          <div className="vd-stat-label">Locked in pool</div>
          <div className="vd-stat-value" style={{ fontSize: '1rem' }}>{fmtBig(totalInVesting)}</div>
        </div>
        <div className="vd-stat" style={{ padding: '1rem' }}>
          <div className="vd-stat-label">Available for vesting</div>
          <div className="vd-stat-value" style={{ fontSize: '1rem' }}>{fmtBig(availableForVesting)}</div>
        </div>
      </div>

      {/* Pool address */}
      {poolAddress ? (
        <div className="vd-card-accent">
          <div className="vd-label" style={{ marginBottom: '0.25rem' }}>Your VestingPool contract</div>
          <a
            href={`${SEPOLIA_EXPLORER_URL}/address/${poolAddress}`}
            target="_blank"
            rel="noreferrer"
            className="vd-addr"
            style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: '0.8125rem' }}
          >
            {poolAddress}
          </a>
        </div>
      ) : (
        <div className="vd-alert vd-alert-info">
          No VestingPool found for your address yet. Create a vesting first.
        </div>
      )}

      {/* Track by ID */}
      <div className="vd-card">
        <div className="vd-title" style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>Track by ID</div>
        <div className="vd-sub" style={{ marginBottom: '0.875rem' }}>
          Paste a vesting ID (bytes32) from a create transaction or receipt.
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <input
            type="text"
          placeholder={"0x\u2026"}
            value={manualVestingId}
            onChange={(e) => setManualVestingId(e.target.value)}
            className="vd-input vd-input-mono"
            style={{ flex: 1 }}
          />
          <button
            onClick={addVestingId}
            disabled={!manualVestingId.startsWith('0x')}
            className="vd-btn vd-btn-primary"
            style={{ padding: '0 1.25rem' }}
          >
            Track
          </button>
        </div>
      </div>

      {/* Empty state */}
      {trackedIds.length === 0 && (
        <div style={{ textAlign: 'center', padding: '2.5rem 0', color: 'var(--muted)', fontStyle: 'italic', fontSize: '0.875rem' }}>
          No vestings tracked yet. Create one or paste a vesting ID above.
        </div>
      )}

      {/* Vesting cards */}
      {trackedIds.map((id) => (
        <VestingCard
          key={id}
          vestingId={id}
          poolAddress={poolAddress}
          tokenSymbol={sym || undefined}
          tokenDecimals={decimals}
          onRemove={() => onRemoveId(id)}
        />
      ))}
    </div>
  )
}
