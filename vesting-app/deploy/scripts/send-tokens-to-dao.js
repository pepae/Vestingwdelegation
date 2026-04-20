/**
 * Send GVT tokens from deployer to the Decent DAO Safe treasury.
 * Run: node scripts/send-tokens-to-dao.js
 */
const path = require('path')
const { ethers } = require('../node_modules/ethers')
require('../node_modules/dotenv').config({ path: path.join(__dirname, '../../.env') })

const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com'
const TOKEN_ADDRESS = process.env.VITE_TOKEN_ADDRESS || '0xcbAf6Bd959049f2Ecc06BF95737c83C929377383'
const DAO_SAFE = '0x09D6b08aE680d159656bE25415B80381D69b8eeD'
const AMOUNT = ethers.parseUnits('10000', 18) // 10,000 GVT

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
]

async function main() {
  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC)
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider)

  console.log(`Sender:     ${wallet.address}`)
  console.log(`Token:      ${TOKEN_ADDRESS}`)
  console.log(`Recipient:  ${DAO_SAFE}  (Decent DAO Treasury)`)
  console.log(`Amount:     10,000 GVT`)

  const token = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, wallet)

  const sym = await token.symbol()
  const beforeSender = await token.balanceOf(wallet.address)
  const beforeDao = await token.balanceOf(DAO_SAFE)

  console.log(`\nBalances before:`)
  console.log(`  Sender: ${ethers.formatUnits(beforeSender, 18)} ${sym}`)
  console.log(`  DAO:    ${ethers.formatUnits(beforeDao, 18)} ${sym}`)

  console.log(`\nSending ${ethers.formatUnits(AMOUNT, 18)} ${sym} to DAO…`)
  const tx = await token.transfer(DAO_SAFE, AMOUNT)
  console.log(`  Tx hash: ${tx.hash}`)
  console.log(`  Waiting for confirmation…`)
  await tx.wait()
  console.log(`  Confirmed ✓`)

  const afterDao = await token.balanceOf(DAO_SAFE)
  console.log(`\nDAO balance after: ${ethers.formatUnits(afterDao, 18)} ${sym}`)
  console.log(`\nDone! DAO funded. View on Decent DAO:`)
  console.log(`  https://app.decentdao.org/home?dao=sep:${DAO_SAFE}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
