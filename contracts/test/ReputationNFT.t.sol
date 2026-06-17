// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ReputationNFT.sol";

contract ReputationNFTTest is Test {
    ReputationNFT nft;
    address owner = address(this);
    address agent1 = address(0xA1);

    function setUp() public {
        nft = new ReputationNFT();
    }

    function test_MintReputation() public {
        uint256 tokenId = nft.mint(agent1, keccak256("hash1"), "TRADING", 50);
        assertEq(tokenId, 1);
        assertTrue(nft.hasMinted(agent1));
        assertEq(nft.ownerOf(tokenId), agent1);
    }

    function test_RevertDoubleMint() public {
        nft.mint(agent1, keccak256("h1"), "TRADING", 50);
        vm.expectRevert(ReputationNFT.AlreadyMinted.selector);
        nft.mint(agent1, keccak256("h2"), "TRADING", 60);
    }

    function test_RevertSoulboundTransfer() public {
        nft.mint(agent1, keccak256("h1"), "TRADING", 50);
        vm.prank(agent1);
        vm.expectRevert(ReputationNFT.SoulboundToken.selector);
        nft.transferFrom(agent1, address(0xB1), 1);
    }

    function test_UpdateRequiresCooldown() public {
        nft.mint(agent1, keccak256("h1"), "TRADING", 50);
        // Should fail immediately (0 time elapsed)
        vm.expectRevert();
        nft.updateDecisionHash(1, keccak256("h2"), 60, 10);
    }

    function test_UpdateAfterCooldown() public {
        nft.mint(agent1, keccak256("h1"), "TRADING", 50);
        vm.warp(block.timestamp + 1 hours + 1);
        nft.updateDecisionHash(1, keccak256("h2"), 75, 10);
        ReputationNFT.ReputationData memory rep = nft.getReputation(1);
        assertEq(rep.score, 75);
        assertEq(rep.totalEvents, 10);
    }

    function test_UpdateRequiresMinEvents() public {
        nft.mint(agent1, keccak256("h1"), "TRADING", 50);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert();
        nft.updateDecisionHash(1, keccak256("h2"), 60, 5); // Only 5 events, need 10
    }

    function test_CooldownRemaining() public {
        nft.mint(agent1, keccak256("h1"), "TRADING", 50);
        uint256 remaining = nft.getCooldownRemaining(1);
        assertEq(remaining, 1 hours);
    }
}
