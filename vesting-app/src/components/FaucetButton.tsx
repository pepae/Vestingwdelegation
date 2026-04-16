import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseUnits } from 'viem'
import { TOKEN_ABI } from '../abis'
import { CONTRACT_ADDRESSES } from '../contracts'

export default function FaucetButton() {
  const { address } = useAccount()
  const { writeContract, data: txHash, isPending, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash })

  function handleMint() {
    if (!address) return
    writeContract({
      address: CONTRACT_ADDRESSES.token,
      abi: TOKEN_ABI,
      functionName: 'mint',
      args: [address, parseUnits('10000', 18)],
    })
  }

  return (
    <button
      className="vd-btn vd-btn-outline"
      onClick={isConfirmed ? reset : handleMint}
      disabled={isPending || isConfirming}
      title="Mint 10,000 GVT test tokens (free testnet faucet)"
      style={isConfirmed ? { color: 'var(--success)', borderColor: 'var(--success)' } : undefined}
    >
      {isConfirmed
        ? '✓ 10k GVT'
        : isPending || isConfirming
        ? 'Minting…'
        : 'Get 10k GVT'}
    </button>
  )
}
