// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @title AgentRegistry
/// @notice Registers AI agents on the Pharos network with metadata hashes
/// @dev Deployed on Pharos Atlantic Testnet (Chain ID: 688689)
contract AgentRegistry {
    // ─── Storage ─────────────────────────────────────────────────────────────
    address public owner;

    struct AgentInfo {
        bool registered;
        bytes32 metadataHash;
        uint256 registeredAt;
        uint256 lastUpdated;
        string agentType; // "TRADING" | "SOCIAL" | "GOVERNANCE" | "BUDGET_ALLOCATOR"
    }

    mapping(address => AgentInfo) private agents;
    address[] private agentList;

    // ─── Events ──────────────────────────────────────────────────────────────
    event AgentRegistered(
        address indexed agent,
        bytes32 metadataHash,
        string agentType,
        uint256 timestamp
    );

    event MetadataUpdated(
        address indexed agent,
        bytes32 oldHash,
        bytes32 newHash,
        uint256 timestamp
    );

    event AgentDeactivated(address indexed agent, uint256 timestamp);

    // ─── Errors ──────────────────────────────────────────────────────────────
    error NotOwner();
    error AlreadyRegistered();
    error NotRegistered();
    error ZeroAddress();
    error EmptyType();

    // ─── Modifiers ───────────────────────────────────────────────────────────
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRegistered(address agent) {
        if (!agents[agent].registered) revert NotRegistered();
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor() {
        owner = msg.sender;
    }

    // ─── Registration ────────────────────────────────────────────────────────
    /// @notice Register a new agent with metadata hash
    /// @param agent The agent's wallet address
    /// @param metadataHash keccak256 hash of the agent's metadata JSON
    /// @param agentType Human-readable agent type string
    function registerAgent(
        address agent,
        bytes32 metadataHash,
        string calldata agentType
    ) external onlyOwner {
        if (agent == address(0)) revert ZeroAddress();
        if (agents[agent].registered) revert AlreadyRegistered();
        if (bytes(agentType).length == 0) revert EmptyType();

        agents[agent] = AgentInfo({
            registered: true,
            metadataHash: metadataHash,
            registeredAt: block.timestamp,
            lastUpdated: block.timestamp,
            agentType: agentType
        });

        agentList.push(agent);

        emit AgentRegistered(agent, metadataHash, agentType, block.timestamp);
    }

    /// @notice Update the metadata hash for a registered agent
    /// @param agent The agent's wallet address
    /// @param newHash New metadata hash
    function updateMetadata(
        address agent,
        bytes32 newHash
    ) external onlyOwner onlyRegistered(agent) {
        bytes32 oldHash = agents[agent].metadataHash;
        agents[agent].metadataHash = newHash;
        agents[agent].lastUpdated = block.timestamp;

        emit MetadataUpdated(agent, oldHash, newHash, block.timestamp);
    }

    /// @notice Check if an address is a registered agent
    function isRegistered(address agent) external view returns (bool) {
        return agents[agent].registered;
    }

    /// @notice Get full agent info
    function getAgent(address agent)
        external
        view
        returns (AgentInfo memory)
    {
        return agents[agent];
    }

    /// @notice Get all registered agent addresses
    function getAllAgents() external view returns (address[] memory) {
        return agentList;
    }

    /// @notice Transfer ownership
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }
}
