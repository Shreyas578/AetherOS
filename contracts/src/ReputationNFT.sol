// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title ReputationNFT
/// @notice Soulbound ERC-721 NFT for AI agent reputation tracking on Pharos
/// @dev Non-transferable (soulbound). Batch updates require 10+ events AND 1hr cooldown.
contract ReputationNFT is ERC721, Ownable {
    // ─── Storage ─────────────────────────────────────────────────────────────
    uint256 private _nextTokenId;

    struct ReputationData {
        bytes32 decisionHash;    // keccak256 of aggregated decision history
        uint256 lastUpdate;      // timestamp of last on-chain update
        uint256 totalEvents;     // total decisions recorded
        uint256 score;           // 0-100 reputation score
        string  agentType;
    }

    mapping(uint256 => ReputationData) private _reputations;
    mapping(address => uint256) private _agentToToken;
    mapping(address => bool)    private _hasMinted;

    // ─── Constants ───────────────────────────────────────────────────────────
    uint256 public constant UPDATE_COOLDOWN = 1 hours;
    uint256 public constant MIN_EVENTS_FOR_UPDATE = 10;

    // ─── Events ──────────────────────────────────────────────────────────────
    event ReputationMinted(
        address indexed agent,
        uint256 tokenId,
        string agentType,
        uint256 timestamp
    );

    event ReputationUpdated(
        uint256 indexed tokenId,
        address indexed agent,
        bytes32 oldHash,
        bytes32 newHash,
        uint256 newScore,
        uint256 totalEvents,
        uint256 timestamp
    );

    // ─── Errors ──────────────────────────────────────────────────────────────
    error SoulboundToken();
    error AlreadyMinted();
    error NotMinted();
    error CooldownNotElapsed(uint256 remainingSeconds);
    error InsufficientEvents(uint256 required, uint256 current);
    error InvalidScore();

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor() ERC721("AetherOS Reputation", "AREP") Ownable(msg.sender) {
        _nextTokenId = 1;
    }

    // ─── Soulbound Override ──────────────────────────────────────────────────
    function transferFrom(address, address, uint256) public pure override {
        revert SoulboundToken();
    }

    function safeTransferFrom(address, address, uint256, bytes memory) public pure override {
        revert SoulboundToken();
    }

    // ─── Minting ─────────────────────────────────────────────────────────────
    /// @notice Mint a reputation NFT for an agent (one per agent)
    /// @param agent The agent's wallet address
    /// @param initialHash Initial decision history hash
    /// @param agentType Human-readable type string
    /// @param initialScore Initial reputation score (0-100)
    function mint(
        address agent,
        bytes32 initialHash,
        string calldata agentType,
        uint256 initialScore
    ) external onlyOwner returns (uint256) {
        if (_hasMinted[agent]) revert AlreadyMinted();
        if (initialScore > 100) revert InvalidScore();

        uint256 tokenId = _nextTokenId++;
        _safeMint(agent, tokenId);

        _reputations[tokenId] = ReputationData({
            decisionHash: initialHash,
            lastUpdate:   block.timestamp,
            totalEvents:  0,
            score:        initialScore,
            agentType:    agentType
        });

        _agentToToken[agent] = tokenId;
        _hasMinted[agent] = true;

        emit ReputationMinted(agent, tokenId, agentType, block.timestamp);
        return tokenId;
    }

    // ─── Reputation Update ───────────────────────────────────────────────────
    /// @notice Update decision hash and score for a token
    /// @dev Requires MIN_EVENTS_FOR_UPDATE new events AND UPDATE_COOLDOWN elapsed
    /// @param tokenId The NFT token ID
    /// @param newHash New aggregated decision hash
    /// @param newScore Updated reputation score (0-100)
    /// @param eventsToAdd Number of new events since last update (must be >= 10)
    function updateDecisionHash(
        uint256 tokenId,
        bytes32 newHash,
        uint256 newScore,
        uint256 eventsToAdd
    ) external onlyOwner {
        ReputationData storage rep = _reputations[tokenId];

        // Check cooldown
        uint256 elapsed = block.timestamp - rep.lastUpdate;
        if (elapsed < UPDATE_COOLDOWN) {
            revert CooldownNotElapsed(UPDATE_COOLDOWN - elapsed);
        }

        // Check minimum events
        if (eventsToAdd < MIN_EVENTS_FOR_UPDATE) {
            revert InsufficientEvents(MIN_EVENTS_FOR_UPDATE, eventsToAdd);
        }

        if (newScore > 100) revert InvalidScore();

        bytes32 oldHash = rep.decisionHash;
        rep.decisionHash = newHash;
        rep.lastUpdate   = block.timestamp;
        rep.totalEvents  += eventsToAdd;
        rep.score        = newScore;

        emit ReputationUpdated(
            tokenId,
            ownerOf(tokenId),
            oldHash,
            newHash,
            newScore,
            rep.totalEvents,
            block.timestamp
        );
    }

    // ─── Views ───────────────────────────────────────────────────────────────
    /// @notice Get full reputation data for a token
    function getReputation(uint256 tokenId)
        external
        view
        returns (ReputationData memory)
    {
        return _reputations[tokenId];
    }

    /// @notice Get token ID for an agent address
    function getTokenId(address agent) external view returns (uint256) {
        if (!_hasMinted[agent]) revert NotMinted();
        return _agentToToken[agent];
    }

    /// @notice Check if an agent has a reputation NFT
    function hasMinted(address agent) external view returns (bool) {
        return _hasMinted[agent];
    }

    /// @notice Get remaining cooldown seconds for a token
    function getCooldownRemaining(uint256 tokenId)
        external
        view
        returns (uint256)
    {
        uint256 elapsed = block.timestamp - _reputations[tokenId].lastUpdate;
        if (elapsed >= UPDATE_COOLDOWN) return 0;
        return UPDATE_COOLDOWN - elapsed;
    }

    /// @notice Get total supply
    function totalSupply() external view returns (uint256) {
        return _nextTokenId - 1;
    }
}
