// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @title SocialInteraction
/// @notice On-chain social graph for AetherOS agents — posts, replies, tips (native PHRS), follows
/// @dev Tips are in native PHRS (msg.value). No ERC-20 dependency.
contract SocialInteraction {
    // ─── Structs ─────────────────────────────────────────────────────────────
    struct Post {
        uint256 id;
        address author;
        bytes32 contentHash;    // keccak256 of content
        string  ipfsUri;        // Pinata IPFS URI
        uint256 timestamp;
        uint256 tipAmount;      // total PHRS tips received (wei)
        uint256 replyCount;
        bool    isReply;
        uint256 parentId;       // 0 if top-level post
    }

    // ─── Storage ─────────────────────────────────────────────────────────────
    uint256 private _postCount;

    mapping(uint256 => Post)    private _posts;
    mapping(address => bool)    private _registered;
    mapping(address => mapping(address => bool)) private _follows;
    mapping(address => uint256) private _followCount;
    mapping(address => uint256) private _followerCount;
    mapping(address => uint256[]) private _userPosts;

    // ─── Events ──────────────────────────────────────────────────────────────
    event Posted(
        uint256 indexed postId,
        address indexed author,
        bytes32 contentHash,
        string  ipfsUri,
        uint256 timestamp
    );

    event Replied(
        uint256 indexed replyId,
        uint256 indexed parentId,
        address indexed author,
        bytes32 contentHash,
        uint256 timestamp
    );

    event Tipped(
        uint256 indexed postId,
        address indexed tipper,
        address indexed author,
        uint256 amount,
        uint256 timestamp
    );

    event Followed(
        address indexed follower,
        address indexed target,
        uint256 timestamp
    );

    event Unfollowed(
        address indexed follower,
        address indexed target,
        uint256 timestamp
    );

    // ─── Errors ──────────────────────────────────────────────────────────────
    error PostNotFound();
    error ZeroTip();
    error CannotTipSelf();
    error CannotFollowSelf();
    error AlreadyFollowing();
    error NotFollowing();
    error TransferFailed();

    // ─── Post ─────────────────────────────────────────────────────────────────
    /// @notice Create a new top-level post
    /// @param contentHash keccak256 hash of the post content
    /// @param ipfsUri     Pinata IPFS URI of the full content metadata
    function post(bytes32 contentHash, string calldata ipfsUri)
        external
        returns (uint256 postId)
    {
        postId = ++_postCount;

        _posts[postId] = Post({
            id:          postId,
            author:      msg.sender,
            contentHash: contentHash,
            ipfsUri:     ipfsUri,
            timestamp:   block.timestamp,
            tipAmount:   0,
            replyCount:  0,
            isReply:     false,
            parentId:    0
        });

        _userPosts[msg.sender].push(postId);

        emit Posted(postId, msg.sender, contentHash, ipfsUri, block.timestamp);
    }

    // ─── Reply ────────────────────────────────────────────────────────────────
    /// @notice Reply to an existing post
    /// @param parentId   The post being replied to
    /// @param contentHash keccak256 hash of reply content
    function reply(
        uint256 parentId,
        bytes32 contentHash,
        string calldata ipfsUri
    ) external returns (uint256 replyId) {
        if (_posts[parentId].timestamp == 0) revert PostNotFound();

        replyId = ++_postCount;

        _posts[replyId] = Post({
            id:          replyId,
            author:      msg.sender,
            contentHash: contentHash,
            ipfsUri:     ipfsUri,
            timestamp:   block.timestamp,
            tipAmount:   0,
            replyCount:  0,
            isReply:     true,
            parentId:    parentId
        });

        _posts[parentId].replyCount++;
        _userPosts[msg.sender].push(replyId);

        emit Replied(replyId, parentId, msg.sender, contentHash, block.timestamp);
    }

    // ─── Tip ─────────────────────────────────────────────────────────────────
    /// @notice Tip a post author in native PHRS
    /// @param postId The post to tip
    function tip(uint256 postId) external payable {
        if (msg.value == 0) revert ZeroTip();

        Post storage p = _posts[postId];
        if (p.timestamp == 0) revert PostNotFound();
        if (p.author == msg.sender) revert CannotTipSelf();

        p.tipAmount += msg.value;

        // Transfer PHRS to author
        (bool success, ) = p.author.call{value: msg.value}("");
        if (!success) revert TransferFailed();

        emit Tipped(postId, msg.sender, p.author, msg.value, block.timestamp);
    }

    // ─── Follow ──────────────────────────────────────────────────────────────
    /// @notice Follow another address
    function follow(address target) external {
        if (target == msg.sender) revert CannotFollowSelf();
        if (_follows[msg.sender][target]) revert AlreadyFollowing();

        _follows[msg.sender][target] = true;
        _followCount[msg.sender]++;
        _followerCount[target]++;

        emit Followed(msg.sender, target, block.timestamp);
    }

    /// @notice Unfollow an address
    function unfollow(address target) external {
        if (!_follows[msg.sender][target]) revert NotFollowing();

        _follows[msg.sender][target] = false;
        _followCount[msg.sender]--;
        _followerCount[target]--;

        emit Unfollowed(msg.sender, target, block.timestamp);
    }

    // ─── Views ───────────────────────────────────────────────────────────────
    function getPost(uint256 postId) external view returns (Post memory) {
        if (_posts[postId].timestamp == 0) revert PostNotFound();
        return _posts[postId];
    }

    function getPostCount() external view returns (uint256) {
        return _postCount;
    }

    function isFollowing(address follower, address target) external view returns (bool) {
        return _follows[follower][target];
    }

    function getFollowCount(address user) external view returns (uint256) {
        return _followCount[user];
    }

    function getFollowerCount(address user) external view returns (uint256) {
        return _followerCount[user];
    }

    function getUserPosts(address user) external view returns (uint256[] memory) {
        return _userPosts[user];
    }

    function getRecentPosts(uint256 count) external view returns (Post[] memory) {
        uint256 start = _postCount > count ? _postCount - count + 1 : 1;
        uint256 len = _postCount >= start ? _postCount - start + 1 : 0;
        Post[] memory result = new Post[](len);
        for (uint256 i = 0; i < len; i++) {
            result[i] = _posts[start + i];
        }
        return result;
    }
}
