require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: "../.env" });

const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.25",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "cancun",
    },
  },
  networks: {
    pharos: {
      url: process.env.PHAROS_RPC_URL || "https://atlantic.dplabs-internal.com",
      chainId: 688689,
      accounts: [DEPLOYER_KEY],
      gasPrice: "auto",
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
