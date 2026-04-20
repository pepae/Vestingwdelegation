/**
 * Standalone deploy script — no Hardhat CLI, just ethers + artifacts.
 * Run from vesting-app/deploy/:
 *   node scripts/deploy-direct.js sepolia
 */
const path = require('path')
const fs = require('fs')
const { ethers } = require('../node_modules/ethers')
require('../node_modules/dotenv').config({ path: path.join(__dirname, '../../.env') })

const NETWORK = process.argv[2] || 'sepolia'

const NETWORKS = {
  sepolia: {
    rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
    chainId: 11155111,
    name: 'Sepolia',
  },
  chiado: {
    rpc: 'https://rpc.chiadochain.net',
    chainId: 10200,
    name: 'Gnosis Chiado',
  },
}

const net = NETWORKS[NETWORK]
if (!net) { console.error('Unknown network:', NETWORK); process.exit(1) }

function loadArtifact(contractName) {
  // Search all known artifact paths
  const searchDirs = [
    path.join(__dirname, '..', 'artifacts', 'contracts'),
    path.join(__dirname, '..', 'artifacts', 'contracts', 'libraries'),
    path.join(__dirname, '..', 'artifacts', 'contracts', 'interfaces'),
  ]
  for (const dir of searchDirs) {
    const artifactPath = path.join(dir, `${contractName}.sol`, `${contractName}.json`)
    if (fs.existsSync(artifactPath)) {
      return JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
    }
  }
  throw new Error(`Artifact not found for ${contractName}. Run hardhat compile first.`)
}

async function main() {
  const provider = new ethers.JsonRpcProvider(net.rpc)
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider)

  console.log(`Network: ${net.name}`)
  console.log(`Deploying with: ${wallet.address}`)

  const balance = await provider.getBalance(wallet.address)
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`)
  if (balance < ethers.parseEther('0.01')) {
    throw new Error('Insufficient ETH balance. Fund the deployer address.')
  }

  async function deploy(contractName, args = [], overrides = {}) {
    const artifact = loadArtifact(contractName)
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet)
    const contract = await factory.deploy(...args, overrides)
    await contract.waitForDeployment()
    const address = await contract.getAddress()
    console.log(`  ${contractName}: ${address}`)
    return { contract, address }
  }

  // 1. VestingLibrary
  console.log('\n[1/4] Deploying VestingLibrary...')
  const { address: vestingLibraryAddr } = await deploy('VestingLibrary')

  // 2. VestingPool implementation (linked library)
  console.log('[2/4] Deploying VestingPool implementation...')
  const vpArtifact = loadArtifact('VestingPool')

  // Link library by replacing placeholder bytes in bytecode using linkReferences offsets
  let vestingPoolBytecode = vpArtifact.bytecode
  const libRefs = vpArtifact.linkReferences?.['contracts/libraries/VestingLibrary.sol']?.['VestingLibrary']
  if (libRefs) {
    const addrHex = vestingLibraryAddr.slice(2).toLowerCase()
    let bytecodeHex = vestingPoolBytecode.slice(2) // strip 0x
    for (const ref of libRefs) {
      const pos = ref.start * 2 // byte offset → hex char offset
      bytecodeHex = bytecodeHex.slice(0, pos) + addrHex + bytecodeHex.slice(pos + 40)
    }
    vestingPoolBytecode = '0x' + bytecodeHex
  }

  const vpFactory = new ethers.ContractFactory(vpArtifact.abi, vestingPoolBytecode, wallet)
  const vestingPoolImpl = await vpFactory.deploy(ethers.ZeroAddress)
  await vestingPoolImpl.waitForDeployment()
  const vestingPoolImplAddr = await vestingPoolImpl.getAddress()
  console.log(`  VestingPool impl: ${vestingPoolImplAddr}`)

  // 3. GenericToken
  console.log('[3/4] Deploying GenericToken...')
  const { address: tokenAddr } = await deploy('GenericToken')

  // 4. VestingPoolManager
  console.log('[4/4] Deploying VestingPoolManager...')
  const { address: managerAddr } = await deploy('VestingPoolManager', [tokenAddr, vestingPoolImplAddr, wallet.address])

  // Update frontend .env
  const envPath = path.join(__dirname, '../../.env')
  let envContent = fs.readFileSync(envPath, 'utf8')
  envContent = envContent
    .replace(/^VITE_VESTING_POOL_MANAGER=.*/m, `VITE_VESTING_POOL_MANAGER=${managerAddr}`)
    .replace(/^VITE_TOKEN_ADDRESS=.*/m, `VITE_TOKEN_ADDRESS=${tokenAddr}`)
  fs.writeFileSync(envPath, envContent)

  console.log('\n✓ Deployment complete. .env updated.')
  console.log('  Token:              ', tokenAddr)
  console.log('  VestingPoolManager: ', managerAddr)
  console.log(`\nEtherscan: https://sepolia.etherscan.io/address/${managerAddr}`)
}

main().catch((err) => {
  console.error('Deploy failed:', err.message || err)
  process.exit(1)
})
