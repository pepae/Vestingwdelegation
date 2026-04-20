import { useState } from 'react'
import { useAccount, useSignTypedData } from 'wagmi'
import { encodeFunctionData, hashTypedData, type Hex } from 'viem'
import { VESTING_POOL_MANAGER_ABI, TOKEN_ABI } from '../abis'
import { CONTRACT_ADDRESSES } from '../contracts'

// Decent DAO on Sepolia — a 1-of-2 Safe multisig named "vestingtest"
export const DECENT_DAO_SAFE = '0x09D6b08aE680d159656bE25415B80381D69b8eeD' as const
export const DECENT_DAO_URL = `https://app.decentdao.org/home?dao=sep:${DECENT_DAO_SAFE}`

// Safe canonical MultiSend v1.3.0 — same address on every EVM chain
const MULTISEND_ADDRESS = '0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761' as `0x${string}`

const SAFE_API_BASE = 'https://api.safe.global/tx-service/sep/api/v1'
const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`
const SEPOLIA_CHAIN_ID = 11155111

// Minimal ABI for MultiSend — just the one function we need
const MULTISEND_ABI = [
  {
    type: 'function' as const,
    name: 'multiSend',
    inputs: [{ name: 'transactions', type: 'bytes' }],
    outputs: [],
    stateMutability: 'payable',
  },
] as const

// EIP-712 types for Safe transactions
const SAFE_TX_TYPES = {
  SafeTx: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'operation', type: 'uint8' },
    { name: 'safeTxGas', type: 'uint256' },
    { name: 'baseGas', type: 'uint256' },
    { name: 'gasPrice', type: 'uint256' },
    { name: 'gasToken', type: 'address' },
    { name: 'refundReceiver', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const

/**
 * Pack a single transaction entry for the MultiSend `transactions` bytes parameter.
 * Layout per call (no ABI padding, raw packed bytes):
 *   uint8  operation   (1 byte)
 *   address to         (20 bytes)
 *   uint256 value      (32 bytes, big-endian)
 *   uint256 dataLength (32 bytes, big-endian)
 *   bytes   data       (dataLength bytes)
 */
function packTx(op: number, to: string, value: bigint, data: string): string {
  const dataHex = data.startsWith('0x') ? data.slice(2) : data
  const dataLen = dataHex.length / 2
  return (
    op.toString(16).padStart(2, '0') +
    to.slice(2).toLowerCase().padStart(40, '0') +
    value.toString(16).padStart(64, '0') +
    dataLen.toString(16).padStart(64, '0') +
    dataHex
  )
}

export type ProposalState = 'idle' | 'signing' | 'submitting' | 'success' | 'error'

export interface VestingParams {
  recipient: `0x${string}`
  curveType: number
  managed: boolean
  durationWeeks: number
  startDate: bigint
  amount: bigint
  initialUnlock: bigint
}

export function useSafeProposal() {
  const { address } = useAccount()
  const [state, setState] = useState<ProposalState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [proposalHash, setProposalHash] = useState<Hex | null>(null)
  const { signTypedDataAsync } = useSignTypedData()

  async function proposeVesting(params: VestingParams) {
    if (!address) return
    setState('signing')
    setError(null)
    setProposalHash(null)

    try {
      // 1. Fetch Safe nonce from Safe Transaction Service
      const safeRes = await fetch(`${SAFE_API_BASE}/safes/${DECENT_DAO_SAFE}/`)
      if (!safeRes.ok) throw new Error(`Safe API ${safeRes.status}: ${await safeRes.text()}`)
      const safeInfo = await safeRes.json()
      const nonce = BigInt(safeInfo.nonce)

      // 2. Encode the two calls that the DAO will execute as a batch:
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

      // 3. Pack as MultiSend transactions bytes (operation=0 → CALL for each inner tx)
      const packed = ('0x' +
        packTx(0, CONTRACT_ADDRESSES.token, 0n, approveData) +
        packTx(0, CONTRACT_ADDRESSES.vestingPoolManager, 0n, vestingData)) as Hex

      const multiSendData = encodeFunctionData({
        abi: MULTISEND_ABI,
        functionName: 'multiSend',
        args: [packed],
      })

      // 4. Build Safe TX struct (operation=1 → DELEGATECALL to MultiSend contract)
      const safeTx = {
        to: MULTISEND_ADDRESS,
        value: 0n,
        data: multiSendData,
        operation: 1,
        safeTxGas: 0n,
        baseGas: 0n,
        gasPrice: 0n,
        gasToken: ZERO_ADDR,
        refundReceiver: ZERO_ADDR,
        nonce,
      } as const

      const domain = {
        chainId: SEPOLIA_CHAIN_ID,
        verifyingContract: DECENT_DAO_SAFE,
      } as const

      // 5. Compute EIP-712 hash (also used as proposal ID in Decent DAO)
      const txHash = hashTypedData({
        domain,
        types: SAFE_TX_TYPES,
        primaryType: 'SafeTx',
        message: safeTx,
      })

      // 6. Sign — this triggers a MetaMask EIP-712 popup
      const signature = await signTypedDataAsync({
        domain,
        types: SAFE_TX_TYPES,
        primaryType: 'SafeTx',
        message: safeTx,
      })

      setState('submitting')

      // 7. Submit proposal to Safe Transaction Service
      const body = {
        to: MULTISEND_ADDRESS,
        value: '0',
        data: multiSendData,
        operation: 1,
        safeTxGas: '0',
        baseGas: '0',
        gasPrice: '0',
        gasToken: ZERO_ADDR,
        refundReceiver: ZERO_ADDR,
        nonce: Number(nonce),
        contractTransactionHash: txHash,
        sender: address,
        signature,
      }

      const postRes = await fetch(
        `${SAFE_API_BASE}/safes/${DECENT_DAO_SAFE}/multisig-transactions/`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )

      if (!postRes.ok) {
        const errText = await postRes.text()
        throw new Error(`Safe API ${postRes.status}: ${errText}`)
      }

      setProposalHash(txHash as Hex)
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
    setProposalHash(null)
  }

  const proposalUrl = proposalHash
    ? `https://app.decentdao.org/proposals/${proposalHash}?dao=sep:${DECENT_DAO_SAFE}`
    : null

  return { proposeVesting, state, error, proposalHash, proposalUrl, reset }
}
