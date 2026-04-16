import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { formatUnits } from 'viem'
import { VESTING_POOL_ABI } from '../abis'

interface Props {
  vestingId: `0x${string}`
  poolAddress: `0x${string}` | undefined
  tokenSymbol?: string
  tokenDecimals: number
  onRemove: () => void
}

export default function VestingCard({ vestingId, poolAddress, tokenSymbol, tokenDecimals, onRemove }: Props) {
  const { address } = useAccount()

  const { data: vesting, isLoading: loadingVesting } = useReadContract({
    address: poolAddress,
    abi: VESTING_POOL_ABI,
    functionName: 'vestings',
    args: [vestingId],
    query: { enabled: !!poolAddress },
  })

  const { data: vestedData } = useReadContract({
    address: poolAddress,
    abi: VESTING_POOL_ABI,
    functionName: 'calculateVestedAmount',
    args: [vestingId],
    query: {
      enabled: !!poolAddress && !!vesting && (vesting as any)[4] <= BigInt(Math.floor(Date.now() / 1000)),
    },
  })

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash })

  function handleClaim() {
    if (!poolAddress || !address) return
    writeContract({
      address: poolAddress,
      abi: VESTING_POOL_ABI,
      functionName: 'claimVestedTokens',
      args: [vestingId, address, BigInt('0xffffffffffffffffffffffffffffffff')],
    })
  }

  if (!poolAddress) {
    return (
      <div className="vd-alert vd-alert-er">No pool address — connect wallet first.</div>
    )
  }

  if (loadingVesting) {
    return (
      <div className="vd-card" style={{ opacity: 0.5 }}>
        <div style={{ height: '1rem', background: 'var(--bg)', width: '40%', marginBottom: '0.5rem' }} />
        <div style={{ height: '0.75rem', background: 'var(--bg)', width: '55%' }} />
      </div>
    )
  }

  if (!vesting || (vesting as any)[5] === 0n) {
    return (
      <div className="vd-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
          Vesting not found for ID <span className="vd-addr" style={{ fontSize: '0.75rem' }}>{vestingId.slice(0, 18)}…</span>
        </span>
        <button onClick={onRemove} className="vd-btn vd-btn-ghost" style={{ color: 'var(--danger)', fontSize: '0.75rem' }}>Remove</button>
      </div>
    )
  }

  const [initialUnlock, curveType, managed, durationWeeks, startDate, amount, amountClaimed, pausingDate, cancelled] = vesting as [
    bigint, number, boolean, number, bigint, bigint, bigint, bigint, boolean, boolean
  ]

  const fmt = (v: bigint) => Number(formatUnits(v, tokenDecimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })

  const startDateMs = Number(startDate) * 1000
  const endDateMs = startDateMs + Number(durationWeeks) * 7 * 24 * 3600 * 1000
  const now = Date.now()
  const elapsed = Math.max(0, now - startDateMs)
  const total = endDateMs - startDateMs
  const progressPct = Math.min(100, total > 0 ? (elapsed / total) * 100 : 0)

  const [vestedAmount, claimedAmount] = vestedData
    ? (vestedData as [bigint, bigint])
    : [amountClaimed, amountClaimed]

  const claimableNow = vestedAmount - claimedAmount

  const statusColor = cancelled ? 'var(--danger)' : pausingDate > 0n ? '#C67A00' : 'var(--success)'
  const statusLabel = cancelled ? 'Cancelled' : pausingDate > 0n ? 'Paused' : 'Active'

  return (
    <div
      className="vd-card"
      style={{
        borderLeft: `4px solid ${statusColor}`,
        opacity: cancelled ? 0.7 : 1,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="vd-badge" style={{ color: statusColor, borderColor: statusColor }}>
            {statusLabel}
          </span>
          <span className="vd-badge">
            {curveType === 0 ? 'Linear' : 'Exponential'}
          </span>
          {managed && <span className="vd-badge">Managed</span>}
          <span className="vd-addr" style={{ fontSize: '0.6875rem', color: 'var(--muted)' }}>
            {vestingId.slice(0, 18)}…
          </span>
        </div>
        <button onClick={onRemove} className="vd-btn vd-btn-ghost" style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', color: 'var(--muted)' }}>✕</button>
      </div>

      {/* Amounts grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', border: '2px solid var(--border)', marginBottom: '1rem' }}>
        <div className="vd-stat" style={{ padding: '0.75rem', borderRight: '2px solid var(--border)' }}>
          <div className="vd-stat-label">Total</div>
          <div className="vd-stat-value" style={{ fontSize: '0.9375rem' }}>{fmt(amount)} <span style={{ fontWeight: 400, fontSize: '0.75rem', color: 'var(--muted)' }}>{tokenSymbol}</span></div>
        </div>
        <div className="vd-stat" style={{ padding: '0.75rem', borderRight: '2px solid var(--border)' }}>
          <div className="vd-stat-label">Vested so far</div>
          <div className="vd-stat-value" style={{ fontSize: '0.9375rem' }}>{fmt(vestedAmount)} <span style={{ fontWeight: 400, fontSize: '0.75rem', color: 'var(--muted)' }}>{tokenSymbol}</span></div>
        </div>
        <div className="vd-stat" style={{ padding: '0.75rem' }}>
          <div className="vd-stat-label">Claimable now</div>
          <div className="vd-stat-value" style={{ fontSize: '0.9375rem', color: claimableNow > 0n ? 'var(--success)' : undefined }}>{fmt(claimableNow)} <span style={{ fontWeight: 400, fontSize: '0.75rem', color: 'var(--muted)' }}>{tokenSymbol}</span></div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6875rem', color: 'var(--muted)', fontStyle: 'italic', marginBottom: '0.375rem' }}>
          <span>{new Date(startDateMs).toLocaleDateString()}</span>
          <span>{progressPct.toFixed(1)}% elapsed</span>
          <span>{new Date(endDateMs).toLocaleDateString()}</span>
        </div>
        <div className="vd-prog-track">
          <div className="vd-prog-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', marginTop: '0.375rem', fontStyle: 'italic' }}>
          {durationWeeks} weeks · Initial unlock: {fmt(initialUnlock)} {tokenSymbol}
        </div>
      </div>

      {/* Claim button */}
      {!cancelled && claimableNow > 0n && (
        <button
          onClick={handleClaim}
          disabled={isPending || isConfirming}
          className="vd-btn vd-btn-primary"
          style={{ width: '100%', padding: '0.6875rem' }}
        >
          {isPending || isConfirming
            ? 'Claiming…'
            : `Claim ${fmt(claimableNow)} ${tokenSymbol ?? ''}`}
        </button>
      )}

      {isConfirmed && (
        <div data-testid="claim-success" className="vd-alert vd-alert-ok" style={{ marginTop: '0.75rem' }}>
          ✓ Tokens claimed successfully.
        </div>
      )}

      {writeError && !isConfirmed && (
        <div data-testid="claim-error" className="vd-alert vd-alert-er" style={{ marginTop: '0.75rem', wordBreak: 'break-all' }}>
          ✗ Claim failed: {writeError.message}
        </div>
      )}
    </div>
  )
}
