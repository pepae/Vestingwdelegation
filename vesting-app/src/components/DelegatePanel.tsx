import { useState } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { VESTING_POOL_ABI } from '../abis'
import { CONTRACT_ADDRESSES, SEPOLIA_EXPLORER_URL } from '../contracts'

export default function DelegatePanel() {
  const { address } = useAccount()
  const [delegatee, setDelegatee] = useState('')
  const [vestingPoolAddress, setVestingPoolAddress] = useState<`0x${string}` | undefined>()

  const { data: poolFromManager } = useReadContract({
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
  })

  const resolvedPool = vestingPoolAddress ?? (poolFromManager as `0x${string}` | undefined)

  const { data: currentDelegate } = useReadContract({
    address: CONTRACT_ADDRESSES.token,
    abi: [
      {
        type: 'function',
        name: 'delegates',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ type: 'address' }],
        stateMutability: 'view',
      },
    ] as const,
    functionName: 'delegates',
    args: [resolvedPool!],
    query: { enabled: !!resolvedPool },
  })

  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash })

  function handleDelegate() {
    if (!resolvedPool || !delegatee) return
    writeContract({
      address: resolvedPool,
      abi: VESTING_POOL_ABI,
      functionName: 'delegateTokens',
      args: [delegatee as `0x${string}`],
    })
  }

  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
  const isDelegated = currentDelegate && currentDelegate !== ZERO_ADDRESS

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '640px' }}>

      {/* Main card */}
      <div className="vd-card-accent">
        <div style={{ marginBottom: '1.25rem', borderBottom: '2px solid var(--border)', paddingBottom: '1rem' }}>
          <div className="vd-title" style={{ fontSize: '1.25rem' }}>Delegate Voting Power</div>
          <div className="vd-sub">
            Tokens locked in your VestingPool can still vote. Assign voting weight
            without moving tokens.
          </div>
        </div>

        {/* Pool address */}
        {resolvedPool ? (
          <div style={{ marginBottom: '1.25rem' }}>
            <div className="vd-label" style={{ marginBottom: '0.25rem' }}>Your VestingPool contract</div>
            <a
              href={`${SEPOLIA_EXPLORER_URL}/address/${resolvedPool}`}
              target="_blank"
              rel="noreferrer"
              className="vd-addr"
              style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: '0.8125rem' }}
            >
              {resolvedPool}
            </a>
            {isDelegated && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--muted)', fontStyle: 'italic' }}>
                Currently delegated to:{' '}
                <span className="vd-addr" style={{ color: 'var(--success)', fontSize: '0.75rem' }}>{currentDelegate}</span>
              </div>
            )}
          </div>
        ) : (
          <div style={{ marginBottom: '1.25rem' }}>
            <div className="vd-label" style={{ marginBottom: '0.375rem' }}>Manual pool address</div>
            <div className="vd-sub" style={{ marginBottom: '0.5rem' }}>
              No pool found for your address. Enter the pool address manually:
            </div>
            <input
              type="text"
              placeholder="VestingPool address (0x…)"
              value={vestingPoolAddress ?? ''}
              onChange={(e) => setVestingPoolAddress(e.target.value as `0x${string}`)}
              className="vd-input vd-input-mono"
            />
          </div>
        )}

        {/* Delegatee input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div>
            <label className="vd-label">Delegate to address</label>
            <input
              type="text"
              placeholder="0x…  (use your own address to self-delegate)"
              value={delegatee}
              onChange={(e) => setDelegatee(e.target.value)}
              className="vd-input vd-input-mono"
            />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              role="button"
              onClick={() => setDelegatee(address ?? '')}
              className="vd-btn vd-btn-outline"
              style={{ fontSize: '0.75rem' }}
            >
              Self-delegate
            </button>
          </div>

          <button
            onClick={handleDelegate}
            disabled={!resolvedPool || !delegatee || isPending || isConfirming}
            className="vd-btn vd-btn-primary"
            style={{ padding: '0.6875rem' }}
          >
            {isPending || isConfirming ? 'Delegating…' : 'Delegate Voting Power'}
          </button>

          {isConfirmed && (
            <div className="vd-alert vd-alert-ok">
              ✓ Delegation updated! Voting weight now follows{' '}
              <span className="vd-addr" style={{ fontSize: '0.8125rem' }}>{delegatee.slice(0, 10)}…</span>
            </div>
          )}
        </div>
      </div>

      {/* Info card */}
      <div className="vd-card">
        <div className="vd-title" style={{ fontSize: '0.875rem', marginBottom: '0.75rem' }}>How delegation works</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--muted)' }}>
          <div>◆ Each beneficiary has an individual <code style={{ fontFamily: 'Courier New', fontSize: '0.8125rem', color: 'var(--text)' }}>VestingPool</code> clone contract</div>
          <div>◆ The pool holds the ERC20Votes token and accumulates voting weight</div>
          <div>◆ Only the <em>pool owner</em> (beneficiary) can call <code style={{ fontFamily: 'Courier New', fontSize: '0.8125rem', color: 'var(--text)' }}>delegateTokens</code></div>
          <div>◆ Tokens can be delegated to any address, including self</div>
          <div>◆ Delegation does not affect the vesting schedule or claim amounts</div>
        </div>
      </div>
    </div>
  )
}
