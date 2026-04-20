import { useState } from 'react'
import { useAccount, useWriteContract, usePublicClient } from 'wagmi'
import { encodeFunctionData, parseEventLogs, type Hex } from 'viem'
import { VESTING_POOL_MANAGER_ABI, TOKEN_ABI } from '../abis'
import { CONTRACT_ADDRESSES } from '../contracts'

// Azorius token-voting DAO on Sepolia
export const DECENT_DAO_SAFE = '0x1fb6663a9eC52287CFa902bC354fd0051BB00a63' as const
export const DECENT_DAO_URL = `https://app.decentdao.org/home?dao=sep:${DECENT_DAO_SAFE}`

// Azorius governance module — receives submitProposal calls
const AZORIUS_ADDRESS = '0xBdc0ff2f3c3F28Ac9ACe33F5e631b7292Bf0478b' as `0x${string}`
// LinearERC20Voting strategy — passed as first arg to submitProposal
const STRATEGY_ADDRESS = '0xb0858a0a4512168b0ed75faa33798c7c392fcc1b' as `0x${string}`

// Minimal Azorius ABI — submitProposal + ProposalCreated event
const AZORIUS_ABI = [
  {
    type: 'function' as const,
    name: 'submitProposal',
    inputs: [
      { name: '_strategy', type: 'address' },
      { name: '_data', type: 'bytes' },
      {
        name: '_transactions',
        type: 'tuple[]',
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
          { name: 'operation', type: 'uint8' },
        ],
      },
      { name: '_metadata', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable' as const,
  },
  {
    type: 'event' as const,
    name: 'ProposalCreated',
    inputs: [
      { name: 'strategy', type: 'address', indexed: false },
      { name: 'proposalId', type: 'uint256', indexed: false },
      { name: 'proposer', type: 'address', indexed: false },
      {
        name: 'transactions',
        type: 'tuple[]',
        indexed: false,
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
          { name: 'operation', type: 'uint8' },
        ],
      },
      { name: 'metadata', type: 'string', indexed: false },
    ],
  },
] as const

export type ProposalState = 'idle' | 'submitting' | 'success' | 'error'

export interface VestingParams {
  recipient: `0x${string}`
  curveType: number
  managed: boolean
  durationWeeks: number
  startDate: bigint
  amount: bigint
  initialUnlock: bigint
  /** Proposal title — stored on-chain in the Azorius ProposalCreated metadata field */
  title?: string
  /** Proposal description — stored on-chain alongside title */
  description?: string
}

export function useSafeProposal() {
  const { address } = useAccount()
  const [state, setState] = useState<ProposalState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [proposalId, setProposalId] = useState<bigint | null>(null)
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()

  async function proposeVesting(params: VestingParams) {
    if (!address) return
    setState('submitting')
    setError(null)
    setProposalId(null)

    try {
      // 1. Encode the two calls the DAO treasury will execute:
      //    a) approve(VestingPoolManager, amount) — grants spending rights from DAO treasury
      //    b) addVesting(...)                     — locks tokens into vesting stream
      const approveData = encodeFunctionData({
        abi: TOKEN_ABI,
        functionName: 'approve',
        args: [CONTRACT_ADDRESSES.vestingPoolManager, params.amount],
      })
      const vestingData = encodeFunctionData({
        abi: VESTING_POOL_MANAGER_ABI,
        functionName: 'addVesting',
        args: [
          params.recipient,
          params.curveType,
          params.managed,
          params.durationWeeks,
          params.startDate,
          params.amount,
          params.initialUnlock,
          false,
        ],
      })

      // 2. Build the transactions array (operation=0 → CALL)
      const transactions = [
        { to: CONTRACT_ADDRESSES.token, value: 0n, data: approveData as Hex, operation: 0 },
        { to: CONTRACT_ADDRESSES.vestingPoolManager, value: 0n, data: vestingData as Hex, operation: 0 },
      ]

      // 3. Build on-chain metadata string — stored directly in the ProposalCreated event,
      //    no IPFS needed. Decent DAO reads this field to display the proposal title.
      const metadata = JSON.stringify({
        title: params.title ?? '',
        description: params.description ?? '',
        documentationUrl: '',
      })

      // 4. Submit via Azorius.submitProposal — triggers MetaMask TX confirmation
      const hash = await writeContractAsync({
        address: AZORIUS_ADDRESS,
        abi: AZORIUS_ABI,
        functionName: 'submitProposal',
        args: [STRATEGY_ADDRESS, '0x', transactions, metadata],
      })

      // 5. Wait for the transaction to be mined and parse the proposal ID from the event
      const receipt = await publicClient!.waitForTransactionReceipt({ hash, timeout: 60_000 })
      const logs = parseEventLogs({ abi: AZORIUS_ABI, logs: receipt.logs, eventName: 'ProposalCreated' })
      const pid = logs[0]?.args?.proposalId as bigint | undefined
      if (pid !== undefined) setProposalId(pid)

      setState('success')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setState('error')
    }
  }

  function reset() {
    setState('idle')
    setError(null)
    setProposalId(null)
  }

  const proposalUrl = proposalId !== null
    ? `https://app.decentdao.org/dao/sep:${DECENT_DAO_SAFE}/proposals/${proposalId}`
    : null

  return { proposeVesting, state, error, proposalUrl, reset }
}
