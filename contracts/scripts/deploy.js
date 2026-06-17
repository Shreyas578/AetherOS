const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("=================================================");
  console.log("  AetherOS — Deploying to Pharos Atlantic Testnet");
  console.log("  Deployer:", deployer.address);
  console.log("  Balance: ", ethers.formatEther(balance), "PHRS");
  console.log("=================================================\n");

  // 1. Deploy AgentRegistry
  console.log("Deploying AgentRegistry...");
  const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
  const registry = await AgentRegistry.deploy();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("✓ AgentRegistry deployed at:", registryAddress);

  // 2. Deploy ReputationNFT
  console.log("Deploying ReputationNFT...");
  const ReputationNFT = await ethers.getContractFactory("ReputationNFT");
  const repNFT = await ReputationNFT.deploy();
  await repNFT.waitForDeployment();
  const nftAddress = await repNFT.getAddress();
  console.log("✓ ReputationNFT deployed at:", nftAddress);

  // 3. Deploy SocialInteraction
  console.log("Deploying SocialInteraction...");
  const SocialInteraction = await ethers.getContractFactory("SocialInteraction");
  const social = await SocialInteraction.deploy();
  await social.waitForDeployment();
  const socialAddress = await social.getAddress();
  console.log("✓ SocialInteraction deployed at:", socialAddress);

  // Write addresses to deployments.env
  const output = [
    `AGENT_REGISTRY_ADDRESS=${registryAddress}`,
    `REPUTATION_NFT_ADDRESS=${nftAddress}`,
    `SOCIAL_INTERACTION_ADDRESS=${socialAddress}`,
  ].join("\n") + "\n";

  const deploymentsPath = path.join(__dirname, "../deployments.env");
  fs.writeFileSync(deploymentsPath, output);

  console.log("\n=================================================");
  console.log("  Deployment complete!");
  console.log("  Addresses saved to contracts/deployments.env");
  console.log("  Copy these into your root .env file:");
  console.log("=================================================");
  console.log(output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
