import { useState, useMemo, useEffect } from 'react'
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi'
import { parseUnits, parseEventLogs, formatUnits } from 'viem'
import { VESTING_POOL_MANAGER_ABI, TOKEN_ABI, VESTING_POOL_ABI } from '../abis'
import { CONTRACT_ADDRESSES } from '../contracts'
import { useSafeProposal, DECENT_DAO_SAFE, DECENT_DAO_URL } from '../hooks/useSafeProposal'

const CURVE_TYPES = [
  { value: 0, label: 'Linear' },
  { value: 1, label: 'Exponential' },
]

interface Props {
  onVestingCreated: (id: `0x${string}`) => void
}

type SendMode = 'direct' | 'dao'

export default function CreateVesting({ onVestingCreated }: Props) {
  const { address } = useAccount()

  const [mode, setMode] = useState<SendMode>('direct')

  const [form, setForm] = useState({
    recipient: '',
    curveType: 0,
    managed: true,
    durationWeeks: 52,
    startDate: new Date().toISOString().slice(0, 16),
    amountTokens: '',
    initialUnlockTokens: '0',
    proposalTitle: '',
    proposalDescription: '',
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

  const { data: tokenBalance } = useReadContract({
    address: CONTRACT_ADDRESSES.token,
    abi: TOKEN_ABI,
    functionName: 'balanceOf',
    args: [address!],
    query: { enabled: !!address && !!CONTRACT_ADDRESSES.token },
  })

  // DAO treasury balance (only polled when in DAO mode)
  const { data: daoBalance, refetch: refetchDaoBalance } = useReadContract({
    address: CONTRACT_ADDRESSES.token,
    abi: TOKEN_ABI,
    functionName: 'balanceOf',
    args: [DECENT_DAO_SAFE],
    query: { enabled: mode === 'dao' && !!CONTRACT_ADDRESSES.token },
  })

  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed, data: receipt } =
    useWaitForTransactionReceipt({ hash: txHash })

  // Separate write instance for "Fund DAO" so state doesn't collide with approve/create
  const { writeContract: writeFund, data: fundTxHash, isPending: isFundPending } = useWriteContract()
  const { isLoading: isFundConfirming, isSuccess: isFundConfirmed } =
    useWaitForTransactionReceipt({ hash: fundTxHash })

  const { proposeVesting, state: proposalState, error: proposalError, proposalUrl, reset: resetProposal } = useSafeProposal()

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

  // Refresh DAO treasury balance after a successful fund transfer
  useEffect(() => {
    if (isFundConfirmed) refetchDaoBalance()
  }, [isFundConfirmed])

  const tokenDecimals = (decimals as number | undefined) ?? 18
  const sym = (symbol as string | undefined) ?? 'tokens'

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

  function handleFundDao() {
    const amount = getAmountBigInt(form.amountTokens)
    if (!amount) return
    writeFund({
      address: CONTRACT_ADDRESSES.token,
      abi: TOKEN_ABI,
      functionName: 'transfer',
      args: [DECENT_DAO_SAFE, amount],
    })
  }

  function handleProposeToDao() {
    const amount = getAmountBigInt(form.amountTokens)
    const initialUnlock = getAmountBigInt(form.initialUnlockTokens)
    if (!amount || !form.recipient) return
    const startDateTs = BigInt(Math.floor(new Date(form.startDate).getTime() / 1000))
    proposeVesting({
      recipient: form.recipient as `0x${string}`,
      curveType: form.curveType,
      managed: form.managed,
      durationWeeks: form.durationWeeks,
      startDate: startDateTs,
      amount,
      initialUnlock,
      title: form.proposalTitle || undefined,
      description: form.proposalDescription || undefined,
    })
  }

  function field(key: keyof typeof form, value: string | number | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (proposalState !== 'idle') resetProposal()
  }

  const needsApproval =
    step === 'idle' &&
    allowance !== undefined &&
    getAmountBigInt(form.amountTokens) > BigInt(String(allowance ?? '0'))

  const insufficientBalance =
    !!form.amountTokens &&
    tokenBalance !== undefined &&
    getAmountBigInt(form.amountTokens) > BigInt(String(tokenBalance ?? '0'))

  const canCreate = !needsApproval || (step !== 'idle' && isConfirmed)

  // DAO treasury has fewer tokens than the vesting amount needs
  const daoNeedsTokens =
    mode === 'dao' &&
    !!form.amountTokens &&
    daoBalance !== undefined &&
    getAmountBigInt(form.amountTokens) > BigInt(String(daoBalance ?? '0'))

  const daoBalanceFormatted =
    daoBalance !== undefined
      ? Number(formatUnits(BigInt(String(daoBalance)), tokenDecimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })
      : '…'

  const isProposing = proposalState === 'signing' || proposalState === 'submitting'

  return (
    <div className="vd-card" style={{ maxWidth: '640px' }}>

      {/* Title */}
      <div style={{ marginBottom: '1.75rem', borderBottom: '2px solid var(--border)', paddingBottom: '1rem' }}>
        <div className="vd-title" style={{ fontSize: '1.25rem' }}>Create Vesting Stream</div>
        <div className="vd-sub">
          Lock tokens with a linear or exponential release schedule.
        </div>
      </div>

      {/* ── Mode toggle ── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: '1.5rem', border: '2px solid var(--border)' }}>
        {([
          { key: 'direct' as const, label: 'Send Directly' },
          { key: 'dao' as const, label: '⬡ Via Decent DAO' },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { setMode(key); resetProposal() }}
            className="vd-btn"
            style={{
              flex: 1,
              padding: '0.5625rem 0.75rem',
              borderRadius: 0,
              border: 'none',
              background: mode === key ? 'var(--accent)' : 'var(--surface)',
              color: mode === key ? '#fff' : 'var(--sub)',
              fontWeight: mode === key ? 'bold' : 'normal',
              letterSpacing: '0.04em',
              fontSize: '0.75rem',
              textTransform: 'uppercase',
            }}
          >
            {label}
          </button>
        ))}
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

        {/* ══ DIRECT MODE ════════════════════════════════════════════════ */}
        {mode === 'direct' && (
          <>
            {insufficientBalance && (
              <div className="vd-alert vd-alert-er" style={{ fontSize: '0.8125rem' }}>
                ✗ Insufficient {sym} balance. Use the <strong>Get 10k {sym}</strong> button in the header to mint test tokens first.
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              {needsApproval && !insufficientBalance && (
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
                disabled={!canCreate || insufficientBalance || isPending || isConfirming || !form.recipient || !form.amountTokens}
                className="vd-btn vd-btn-primary"
                style={{ flex: 1, padding: '0.6875rem' }}
              >
                {step === 'creating' && (isPending || isConfirming) ? 'Creating...' : 'Create Vesting'}
              </button>
            </div>

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
          </>
        )}

        {/* ══ DAO MODE ═══════════════════════════════════════════════════ */}
        {mode === 'dao' && (
          <>
            {/* DAO treasury status */}
            <div style={{ padding: '0.875rem', border: '2px solid var(--accent)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '0.6875rem', fontWeight: 'bold', letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--accent)' }}>
                    ⬡ Decent DAO Treasury
                  </div>
                  <a
                    href={DECENT_DAO_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="vd-addr"
                    style={{ fontSize: '0.6875rem', marginTop: '0.25rem', display: 'block', textDecoration: 'none', color: 'var(--sub)' }}
                  >
                    {DECENT_DAO_SAFE} ↗
                  </a>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '1rem' }}>
                  <div style={{ fontSize: '0.625rem', color: 'var(--sub)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{sym} balance</div>
                  <div style={{ fontWeight: 'bold', fontSize: '1rem' }}>{daoBalanceFormatted}</div>
                </div>
              </div>

              {/* Fund DAO button – only when treasury is short AND user has tokens */}
              {daoNeedsTokens && !insufficientBalance && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.625rem' }}>
                  <div className="vd-sub" style={{ fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                    Treasury needs {form.amountTokens} {sym} to execute this vesting. Send from your wallet:
                  </div>
                  <button
                    onClick={handleFundDao}
                    disabled={isFundPending || isFundConfirming}
                    className="vd-btn vd-btn-outline"
                    style={{ width: '100%', padding: '0.5625rem' }}
                  >
                    {isFundConfirmed
                      ? `✓ Sent ${form.amountTokens} ${sym} to DAO`
                      : isFundPending || isFundConfirming
                      ? 'Sending…'
                      : `Fund DAO Treasury (${form.amountTokens} ${sym})`}
                  </button>
                </div>
              )}

              {/* Not enough user tokens to fund DAO */}
              {daoNeedsTokens && insufficientBalance && (
                <div className="vd-alert vd-alert-er" style={{ fontSize: '0.8125rem', marginTop: '0.25rem' }}>
                  ✗ You don't have enough {sym} to fund the DAO. Click <strong>Get 10k {sym}</strong> in the header first.
                </div>
              )}
            </div>

            {/* Proposal metadata */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <label className="vd-label">Proposal title</label>
                <input
                  type="text"
                  data-testid="proposal-title"
                  placeholder="e.g. Vest 50 GVT for contributor"
                  value={form.proposalTitle}
                  onChange={(e) => field('proposalTitle', e.target.value)}
                  className="vd-input"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label className="vd-label">Proposal description (optional)</label>
                <textarea
                  data-testid="proposal-description"
                  placeholder="Why this vesting? Add context for other signers…"
                  value={form.proposalDescription}
                  onChange={(e) => field('proposalDescription', e.target.value)}
                  className="vd-input"
                  rows={3}
                  style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>
            </div>

            {/* Explanation */}
            <div className="vd-alert vd-alert-info" style={{ fontSize: '0.8125rem' }}>
              <strong>How it works:</strong> Your wallet signs a Safe multisig proposal that batches{' '}
              <code>approve</code> + <code>addVesting</code> into one atomic MultiSend transaction.{' '}
              As a 1-of-2 signer you can confirm and execute it immediately from the Decent DAO UI.
            </div>

            {/* Propose button */}
            <button
              onClick={handleProposeToDao}
              disabled={isProposing || daoNeedsTokens || !form.recipient || !form.amountTokens}
              className="vd-btn vd-btn-primary"
              style={{ padding: '0.6875rem', width: '100%' }}
            >
              {proposalState === 'signing'
                ? 'Sign in wallet…'
                : proposalState === 'submitting'
                ? 'Submitting to Safe…'
                : '⬡ Propose to Decent DAO'}
            </button>

            {/* Proposal success */}
            {proposalState === 'success' && proposalUrl && (
              <div className="vd-alert vd-alert-ok">
                <div style={{ fontWeight: 'bold', marginBottom: '0.625rem' }}>
                  ✓ Proposal submitted to Decent DAO
                </div>
                <div className="vd-sub" style={{ fontSize: '0.75rem', marginBottom: '0.75rem' }}>
                  As a 1-of-2 signer you can confirm and execute immediately.
                </div>
                <a
                  href={proposalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="vd-btn vd-btn-outline"
                  style={{ display: 'inline-block', fontSize: '0.75rem', padding: '0.375rem 0.75rem', textDecoration: 'none' }}
                >
                  View &amp; Execute on Decent DAO ↗
                </a>
              </div>
            )}

            {/* Proposal error */}
            {proposalState === 'error' && proposalError && (
              <div className="vd-alert vd-alert-er" style={{ fontSize: '0.8125rem', wordBreak: 'break-all' }}>
                ✗ {proposalError}
                <div style={{ marginTop: '0.5rem' }}>
                  <button className="vd-btn vd-btn-ghost" style={{ fontSize: '0.6875rem' }} onClick={resetProposal}>
                    Try again
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
