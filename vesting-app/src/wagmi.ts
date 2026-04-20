import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { sepolia } from 'viem/chains'

export const wagmiConfig = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  transports: {
    [sepolia.id]: http('https://ethereum-sepolia-rpc.publicnode.com'),
  },
})
