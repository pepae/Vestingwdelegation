// Contract addresses on Gnosis Chiado testnet
// Update these after deploying the contracts

export const CONTRACT_ADDRESSES = {
  // The VestingPoolManager – deploy this first (after VestingPool impl + token)
  vestingPoolManager: (import.meta.env.VITE_VESTING_POOL_MANAGER ?? '') as `0x${string}`,
  // The underlying ERC20Votes token (SHU or test token)
  token: (import.meta.env.VITE_TOKEN_ADDRESS ?? '') as `0x${string}`,
} as const

export const CHIADO_FAUCET_URL = 'https://faucet.chiadochain.net'
export const CHIADO_EXPLORER_URL = 'https://sepolia.etherscan.io'
