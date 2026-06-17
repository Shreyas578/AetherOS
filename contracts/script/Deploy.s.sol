// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/AgentRegistry.sol";
import "../src/ReputationNFT.sol";
import "../src/SocialInteraction.sol";

/// @title Deploy — AetherOS Contract Deployment Script
/// @notice Run: forge script script/Deploy.s.sol --rpc-url $PHAROS_RPC_URL --broadcast --verify
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("=================================================");
        console.log("  AetherOS — Deploying to Pharos Atlantic Testnet");
        console.log("  Chain ID:", block.chainid);
        console.log("  Deployer:", deployer);
        console.log("=================================================");

        vm.startBroadcast(deployerKey);

        // 1. Deploy AgentRegistry
        AgentRegistry registry = new AgentRegistry();
        console.log("AgentRegistry deployed at:", address(registry));

        // 2. Deploy ReputationNFT
        ReputationNFT repNFT = new ReputationNFT();
        console.log("ReputationNFT deployed at:", address(repNFT));

        // 3. Deploy SocialInteraction
        SocialInteraction social = new SocialInteraction();
        console.log("SocialInteraction deployed at:", address(social));

        vm.stopBroadcast();

        // Write addresses to file for use in .env
        string memory output = string(abi.encodePacked(
            "AGENT_REGISTRY_ADDRESS=", vm.toString(address(registry)), "\n",
            "REPUTATION_NFT_ADDRESS=", vm.toString(address(repNFT)), "\n",
            "SOCIAL_INTERACTION_ADDRESS=", vm.toString(address(social)), "\n"
        ));

        vm.writeFile("./deployments.env", output);
        console.log("\nAddresses saved to deployments.env");
        console.log("Copy these into your .env file!");
    }
}
