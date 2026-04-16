import { useState, useMemo, useEffect } from 'react'
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi'
import { parseUnits, parseEventLogs } from 'viem'
import { VESTING_POOL_MANAGER_ABI, TOKEN_ABI, VESTING_POOL_ABI } from '../abis'
import { CONTRACT_ADDRESSES } from '../contracts'

const CURVE_TYPES = [
  { value: 0, label: 'Linear' },
  { value: 1, label: 'Exponential' },
]

interface Props {
  onVestingCreated: (id: `0x${string}`) => void
}

export default function CreateVesting({ onVestingCreated }: Props) {
  const { address } = useAccount()

  const [form, setForm] = useState({
    recipient: '',
    curveType: 0,
    managed: true,
    durationWeeks: 52,
    startDate: new Date().toISOString().slice(0, 16),
    amountTokens: '',
    initialUnlockTokens: '0',
  })

  const [step, setStep] = useState<'idle' | 'approving' | 'creating'>('idle')

  const { data: decimals } = useReadContract({
    address: CONTRACT_ADDRESSES.token,
    abi: TOKEN_ABI,
    functionName: 'decimals',
    query: { enabled: !!CONTRACT_ADDRESSES.token },
  })

  const { data: symbol } = useReadContract({
    address: CONTRACT_ADDRESSES.token,
    abi: TOKEN_ABI,
    functionName: 'symbol',
    query: { enabled: !!CONTRACT_ADDRESSES.token },
  })

  const { data: allowance } = useReadContract({
    address: CONTRACT_ADDRESSES.token,
    abi: TOKEN_ABI,
    functionName: 'allowance',
    args: [address!, CONTRACT_ADDRESSES.vestingPoolManager],
    query: { enabled: !!address && !!CONTRACT_ADDRESSES.token },
  })

  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed, data: receipt } =
    useWaitForTransactionReceipt({ hash: txHash })

  const vestingId = useMemo(() => {
    if (!receipt || step !== 'creating') return null
    try {
      const logs = parseEventLogs({ abi: VESTING_POOL_ABI, eventName: 'AddedVesting', logs: receipt.logs })
      return (logs[0]?.args as { id?: `0x${string}` })?.id ?? null
    } catch {
      return null
    }
  }, [receipt, step])

  // Auto-add to tracked list and switch to My Vestings tab
  useEffect(() => {
    if (vestingId) onVestingCreated(vestingId)
  }, [vestingId])

  const tokenDecimals = (decimals as number | undefined) ?? 18

  function getAmountBigInt(value: string) {
    if (!value || isNaN(Number(value))) return 0n
    return parseUnits(value, tokenDecimals)
  }

  function handleApprove() {
    const amount = getAmountBigInt(form.amountTokens)
    if (!amount) return
    setStep('approving')
    writeContract({
      address: CONTRACT_ADDRESSES.token,
      abi: TOKEN_ABI,
      functionName: 'approve',
      args: [CONTRACT_ADDRESSES.vestingPoolManager, amount],
    })
  }

  function handleCreate() {
    const amount = getAmountBigInt(form.amountTokens)
    const initialUnlock = getAmountBigInt(form.initialUnlockTokens)
    if (!amount || !form.recipient) return
    const startDateTs = BigInt(Math.floor(new Date(form.startDate).getTime() / 1000))
    setStep('creating')
    writeContract({
      address: CONTRACT_ADDRESSES.vestingPoolManager,
      abi: VESTING_POOL_MANAGER_ABI,
      functionName: 'addVesting',
      args: [
        form.recipient as `0x${string}`,
        form.curveType,
        form.managed,
        form.durationWeeks,
        startDateTs,
        amount as bigint,
        initialUnlock as bigint,
        false,
      ],
    })
  }

  const needsApproval =
    step === 'idle' &&
    allowance !== undefined &&
    getAmountBigInt(form.amountTokens) > BigInt(String(allowance ?? '0'))

  const canCreate = !needsApproval || (step !== 'idle' && isConfirmed)

  function field(key: keyof typeof form, value: string | number | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const sym = (symbol as string | undefined) ?? 'tokens'

  return (
    <div className="vd-card" style={{ maxWidth: '640px' }}>

      {/* Title */}
      <div style={{ marginBottom: '1.75rem', borderBottom: '2px solid var(--border)', paddingBottom: '1rem' }}>
        <div className="vd-title" style={{ fontSize: '1.25rem' }}>Create Vesting Stream</div>
        <div className="vd-sub">
          Lock tokens with a linear or exponential release schedule.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        {/* Recipient */}
        <div>
          <label className="vd-label">Recipient address</label>
          <input
            type="text"
            placeholder="0x..."
            value={form.recipient}
            onChange={(e) => field('recipient', e.target.value)}
            className="vd-input vd-input-mono"
          />
          {address && (
            <button
              className="vd-btn vd-btn-ghost"
              style={{ marginTop: '0.375rem', fontSize: '0.625rem', padding: '0.25rem 0.625rem' }}
              onClick={() => field('recipient', address)}
            >
              Use my address
            </button>
          )}
        </div>

        {/* Amounts */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <label className="vd-label">Total amount ({sym})</label>
            <input
              type="number"
              min="0"
              placeholder="1000"
              value={form.amountTokens}
              onChange={(e) => field('amountTokens', e.target.value)}
              className="vd-input"
            />
          </div>
          <div>
            <label className="vd-label">Initial unlock ({sym})</label>
            <input
              type="number"
              min="0"
              placeholder="0"
              value={form.initialUnlockTokens}
              onChange={(e) => field('initialUnlockTokens', e.target.value)}
              className="vd-input"
            />
          </div>
        </div>

        {/* Duration + Start */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <label className="vd-label">Duration (weeks)</label>
            <input
              type="number"
              min="1"
              max="65535"
              value={form.durationWeeks}
              onChange={(e) => field('durationWeeks', Number(e.target.value))}
              className="vd-input"
            />
          </div>
          <div>
            <label className="vd-label">Start date</label>
            <input
              type="datetime-local"
              value={form.startDate}
              onChange={(e) => field('startDate', e.target.value)}
              className="vd-input"
            />
          </div>
        </div>

        {/* Curve type */}
        <div>
          <label className="vd-label">Vesting curve</label>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            {CURVE_TYPES.map((c) => (
              <button
                key={c.value}
                onClick={() => field('curveType', c.value)}
                className="vd-btn"
                style={{
                  flex: 1,
                  padding: '0.625rem',
                  background: form.curveType === c.value ? 'var(--border)' : 'var(--surface)',
                  color: form.curveType === c.value ? '#fff' : 'var(--text)',
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Managed toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.75rem', border: '2px solid var(--border)', background: 'var(--bg)' }}>
          <input
            type="checkbox"
            id="managed"
            checked={form.managed}
            onChange={(e) => field('managed', e.target.checked)}
            style={{ width: '1rem', height: '1rem', accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }}
          />
          <label htmlFor="managed" style={{ fontSize: '0.8125rem', cursor: 'pointer', lineHeight: 1.4 }}>
            <span style={{ fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.75rem' }}>Managed</span>
            <span className="vd-sub" style={{ display: 'block', marginTop: '0.125rem' }}>Pool admin can pause or cancel this vesting</span>
          </label>
        </div>

        {/* Info */}
        <div className="vd-alert vd-alert-info">
          <span style={{ fontStyle: 'normal', fontWeight: 'bold', letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '0.6875rem' }}>Delegation:</span>{' '}
          The vesting pool contract holds the tokens. Recipients delegate voting power from the{' '}
          <em>Delegate</em> tab &mdash; no token transfer required.
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {needsApproval && (
            <button
              onClick={handleApprove}
              disabled={isPending || isConfirming}
              className="vd-btn vd-btn-outline"
              style={{ flex: 1, padding: '0.6875rem' }}
            >
              {isPending || isConfirming ? 'Approving...' : `Approve ${sym}`}
            </button>
          )}
          <button
            onClick={handleCreate}
            disabled={!canCreate || isPending || isConfirming || !form.recipient || !form.amountTokens}
            className="vd-btn vd-btn-primary"
            style={{ flex: 1, padding: '0.6875rem' }}
          >
            {step === 'creating' && (isPending || isConfirming) ? 'Creating...' : 'Create Vesting'}
          </button>
        </div>

        {/* Success */}
        {isConfirmed && step === 'creating' && (
          <div className="vd-alert vd-alert-ok">
            <div style={{ fontWeight: 'bold', marginBottom: vestingId ? '0.625rem' : 0 }}>
              &#x2713; Vesting created &mdash; added to My Vestings
            </div>
            {vestingId && (
              <>
                <div style={{ fontSize: '0.6875rem', fontWeight: 'bold', letterSpacing: '0.07em', textTransform: 'uppercase', fontStyle: 'italic', marginBottom: '0.25rem' }}>
                  Vesting ID (click to copy):
                </div>
                <div
                  data-testid="vesting-id"
                  className="vd-addr"
                  style={{ color: 'var(--success)', cursor: 'pointer', fontSize: '0.8125rem' }}
                  onClick={() => navigator.clipboard.writeText(vestingId)}
                  title="Click to copy"
                >
                  {vestingId}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
