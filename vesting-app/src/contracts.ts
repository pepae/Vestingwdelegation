// Contract addresses on Sepolia testnet
// Deployed 2026-04-20

const SEPOLIA_MANAGER = '0x52a859FF891167785c2DfB5Bda47aA2290fd204C'
const SEPOLIA_TOKEN   = '0xcbAf6Bd959049f2Ecc06BF95737c83C929377383'

export const CONTRACT_ADDRESSES = {
  // The VestingPoolManager – env var overrides the hardcoded Sepolia address
  vestingPoolManager: (import.meta.env.VITE_VESTING_POOL_MANAGER || SEPOLIA_MANAGER) as `0x${string}`,
  // The underlying ERC20Votes token (SHU or test token)
  token: (import.meta.env.VITE_TOKEN_ADDRESS || SEPOLIA_TOKEN) as `0x${string}`,
} as const

export const SEPOLIA_EXPLORER_URL = 'https://sepolia.etherscan.io'
