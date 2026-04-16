import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { defineChain } from 'viem'

export const chiadoChain = defineChain({
  id: 10200,
  name: 'Gnosis Chiado',
  nativeCurrency: { name: 'Chiado xDAI', symbol: 'xDAI', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.chiadochain.net'] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://blockscout.chiadochain.net' },
  },
  testnet: true,
})

export const wagmiConfig = createConfig({
  chains: [chiadoChain],
  connectors: [injected()],
  transports: {
    [chiadoChain.id]: http('https://rpc.chiadochain.net'),
  },
})
