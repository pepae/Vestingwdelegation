require("@nomicfoundation/hardhat-toolbox");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

// Load env from the frontend .env file
dotenv.config({ path: path.join(__dirname, "../.env") });

async function main() {
  const hre = require("hardhat");
  const { ethers } = hre;

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");
  if (balance < ethers.parseEther("0.01")) {
    throw new Error("Insufficient ETH. Fund the deployer address with Sepolia ETH.");
  }

  // 1. Deploy VestingLibrary
  console.log("\n[1/4] Deploying VestingLibrary...");
  const VestingLibrary = await ethers.getContractFactory("VestingLibrary");
  const vestingLibrary = await VestingLibrary.deploy();
  await vestingLibrary.waitForDeployment();
  const vestingLibraryAddr = await vestingLibrary.getAddress();
  console.log("    VestingLibrary:", vestingLibraryAddr);

  // 2. Deploy VestingPool implementation (sptToken = zero address, requiresSPT not used)
  console.log("[2/4] Deploying VestingPool implementation...");
  const VestingPool = await ethers.getContractFactory("VestingPool", {
    libraries: { VestingLibrary: vestingLibraryAddr },
  });
  const vestingPoolImpl = await VestingPool.deploy(ethers.ZeroAddress);
  await vestingPoolImpl.waitForDeployment();
  const vestingPoolImplAddr = await vestingPoolImpl.getAddress();
  console.log("    VestingPool impl:", vestingPoolImplAddr);

  // 3. Deploy GenericToken
  console.log("[3/4] Deploying GenericToken (GVT)...");
  const GenericToken = await ethers.getContractFactory("GenericToken");
  const token = await GenericToken.deploy();
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("    GenericToken:", tokenAddr);

  // 4. Deploy VestingPoolManager (dao = deployer so deployer can addVesting)
  console.log("[4/4] Deploying VestingPoolManager...");
  const VestingPoolManager = await ethers.getContractFactory("VestingPoolManager");
  const manager = await VestingPoolManager.deploy(tokenAddr, vestingPoolImplAddr, deployer.address);
  await manager.waitForDeployment();
  const managerAddr = await manager.getAddress();
  console.log("    VestingPoolManager:", managerAddr);

  // Update the frontend .env
  const envPath = path.join(__dirname, "../../.env");
  let envContent = fs.readFileSync(envPath, "utf8");
  envContent = envContent
    .replace(/^VITE_VESTING_POOL_MANAGER=.*/m, `VITE_VESTING_POOL_MANAGER=${managerAddr}`)
    .replace(/^VITE_TOKEN_ADDRESS=.*/m, `VITE_TOKEN_ADDRESS=${tokenAddr}`);
  fs.writeFileSync(envPath, envContent);

  console.log("\n✓ Deployment complete. .env updated.");
  console.log("  Token:              ", tokenAddr);
  console.log("  VestingPoolManager: ", managerAddr);
  console.log("\nEtherscan: https://sepolia.etherscan.io/address/" + managerAddr);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
