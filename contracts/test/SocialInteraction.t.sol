// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/SocialInteraction.sol";

contract SocialInteractionTest is Test {
    SocialInteraction social;
    address alice = address(0xA1);
    address bob   = address(0xB0B);

    function setUp() public {
        social = new SocialInteraction();
        vm.deal(alice, 100 ether);
        vm.deal(bob,   100 ether);
    }

    function test_Post() public {
        vm.prank(alice);
        uint256 postId = social.post(keccak256("hello"), "ipfs://Qm123");
        assertEq(postId, 1);
        SocialInteraction.Post memory p = social.getPost(1);
        assertEq(p.author, alice);
        assertEq(p.ipfsUri, "ipfs://Qm123");
    }

    function test_Reply() public {
        vm.prank(alice);
        social.post(keccak256("hello"), "ipfs://Qm123");

        vm.prank(bob);
        uint256 replyId = social.reply(1, keccak256("reply"), "ipfs://Qm456");
        assertEq(replyId, 2);
        assertTrue(social.getPost(2).isReply);
        assertEq(social.getPost(1).replyCount, 1);
    }

    function test_TipPhrs() public {
        vm.prank(alice);
        social.post(keccak256("hello"), "ipfs://Qm123");

        uint256 aliceBalanceBefore = alice.balance;
        vm.prank(bob);
        social.tip{value: 1 ether}(1);

        assertEq(alice.balance, aliceBalanceBefore + 1 ether);
        assertEq(social.getPost(1).tipAmount, 1 ether);
    }

    function test_CannotTipSelf() public {
        vm.prank(alice);
        social.post(keccak256("hello"), "ipfs://Qm123");
        vm.prank(alice);
        vm.expectRevert(SocialInteraction.CannotTipSelf.selector);
        social.tip{value: 1 ether}(1);
    }

    function test_Follow() public {
        vm.prank(alice);
        social.follow(bob);
        assertTrue(social.isFollowing(alice, bob));
        assertEq(social.getFollowCount(alice), 1);
        assertEq(social.getFollowerCount(bob), 1);
    }

    function test_Unfollow() public {
        vm.prank(alice);
        social.follow(bob);
        vm.prank(alice);
        social.unfollow(bob);
        assertFalse(social.isFollowing(alice, bob));
    }

    function test_RevertFollowSelf() public {
        vm.prank(alice);
        vm.expectRevert(SocialInteraction.CannotFollowSelf.selector);
        social.follow(alice);
    }
}
