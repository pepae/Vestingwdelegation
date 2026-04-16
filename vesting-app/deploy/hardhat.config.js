require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: "../.env" });

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    chiado: {
      url: "https://rpc.chiadochain.net",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      chainId: 10200,
      gasPrice: "auto",
    },
  },
};
