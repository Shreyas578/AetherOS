// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/AgentRegistry.sol";

contract AgentRegistryTest is Test {
    AgentRegistry registry;
    address owner = address(this);
    address agent1 = address(0x1);
    address agent2 = address(0x2);

    function setUp() public {
        registry = new AgentRegistry();
    }

    function test_RegisterAgent() public {
        bytes32 hash = keccak256("metadata1");
        registry.registerAgent(agent1, hash, "TRADING");

        assertTrue(registry.isRegistered(agent1));
        AgentRegistry.AgentInfo memory info = registry.getAgent(agent1);
        assertEq(info.metadataHash, hash);
        assertEq(info.agentType, "TRADING");
    }

    function test_RevertOnDuplicateRegister() public {
        registry.registerAgent(agent1, keccak256("meta"), "TRADING");
        vm.expectRevert(AgentRegistry.AlreadyRegistered.selector);
        registry.registerAgent(agent1, keccak256("meta2"), "SOCIAL");
    }

    function test_UpdateMetadata() public {
        registry.registerAgent(agent1, keccak256("meta1"), "TRADING");
        bytes32 newHash = keccak256("meta2");
        registry.updateMetadata(agent1, newHash);
        assertEq(registry.getAgent(agent1).metadataHash, newHash);
    }

    function test_RevertUpdateUnregistered() public {
        vm.expectRevert(AgentRegistry.NotRegistered.selector);
        registry.updateMetadata(agent1, keccak256("x"));
    }

    function test_OnlyOwnerCanRegister() public {
        vm.prank(agent2);
        vm.expectRevert(AgentRegistry.NotOwner.selector);
        registry.registerAgent(agent1, keccak256("meta"), "TRADING");
    }

    function test_GetAllAgents() public {
        registry.registerAgent(agent1, keccak256("m1"), "TRADING");
        registry.registerAgent(agent2, keccak256("m2"), "SOCIAL");
        address[] memory all = registry.getAllAgents();
        assertEq(all.length, 2);
    }
}
