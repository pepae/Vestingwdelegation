// ABI fragments for VestingPool (per-user contract)
export const VESTING_POOL_ABI = [
  {
    type: 'function',
    name: 'delegateTokens',
    inputs: [{ name: 'delegatee', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'claimVestedTokens',
    inputs: [
      { name: 'vestingId', type: 'bytes32' },
      { name: 'beneficiary', type: 'address' },
      { name: 'tokensToClaim', type: 'uint128' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'calculateVestedAmount',
    inputs: [{ name: 'vestingId', type: 'bytes32' }],
    outputs: [
      { name: 'vestedAmount', type: 'uint128' },
      { name: 'claimedAmount', type: 'uint128' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'vestings',
    inputs: [{ name: 'vestingId', type: 'bytes32' }],
    outputs: [
      { name: 'initialUnlock', type: 'uint128' },
      { name: 'curveType', type: 'uint8' },
      { name: 'managed', type: 'bool' },
      { name: 'durationWeeks', type: 'uint16' },
      { name: 'startDate', type: 'uint64' },
      { name: 'amount', type: 'uint128' },
      { name: 'amountClaimed', type: 'uint128' },
      { name: 'pausingDate', type: 'uint64' },
      { name: 'cancelled', type: 'bool' },
      { name: 'requiresSPT', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'token',
    inputs: [],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalTokensInVesting',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'tokensAvailableForVesting',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'AddedVesting',
    inputs: [{ name: 'id', type: 'bytes32', indexed: true }],
  },
  {
    type: 'event',
    name: 'ClaimedVesting',
    inputs: [
      { name: 'id', type: 'bytes32', indexed: true },
      { name: 'beneficiary', type: 'address', indexed: true },
    ],
  },
] as const

// ABI fragments for VestingPoolManager (factory/manager)
export const VESTING_POOL_MANAGER_ABI = [
  {
    type: 'function',
    name: 'addVesting',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'curveType', type: 'uint8' },
      { name: 'managed', type: 'bool' },
      { name: 'durationWeeks', type: 'uint16' },
      { name: 'startDate', type: 'uint64' },
      { name: 'amount', type: 'uint128' },
      { name: 'initialUnlock', type: 'uint128' },
      { name: 'requiresSPT', type: 'bool' },
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getVestingPool',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'token',
    inputs: [],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
] as const

// Minimal ERC20 + ERC20Votes ABI for approve + allowance + balanceOf
export const TOKEN_ABI = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'symbol',
    inputs: [],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'delegates',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'mint',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const
