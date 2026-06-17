import { ethers } from 'ethers';
import { ReputationResult } from '../shared/types';
import { callContract } from '../wallet/index';
import { createLogger } from '../shared/index';
import 'dotenv/config';

const logger = createLogger('reputation');

const REPUTATION_NFT_ABI = [
  'function mint(address agent, bytes32 initialHash, string calldata agentType, uint256 initialScore) external returns (uint256)',
  'function updateDecisionHash(uint256 tokenId, bytes32 newHash, uint256 newScore, uint256 eventsToAdd) external',
  'function getReputation(uint256 tokenId) external view returns (tuple(bytes32 decisionHash, uint256 lastUpdate, uint256 totalEvents, uint256 score, string agentType))',
  'function getTokenId(address agent) external view returns (uint256)',
  'function hasMinted(address agent) external view returns (bool)',
  'function getCooldownRemaining(uint256 tokenId) external view returns (uint256)',
];

/**
 * Compute reputation score for a wallet from on-chain tx history
 */
export async function computeReputation(
  wallet: string,
  rpcUrl?: string
): Promise<ReputationResult> {
  const provider = new ethers.JsonRpcProvider(
    rpcUrl || process.env.PHAROS_RPC_URL
  );

  logger.info('Computing reputation for wallet', { wallet });

  try {
    // Fetch transaction count (proxy for activity)
    const txCount = await provider.getTransactionCount(wallet);

    // Get account age by fetching first tx block (approximate via low nonce)
    const currentBlock = await provider.getBlockNumber();
    const currentBlockData = await provider.getBlock(currentBlock);
    const currentTime = currentBlockData?.timestamp || Math.floor(Date.now() / 1000);

    // Estimate age: assume ~2s block time on Pharos, 1 tx per day average
    const estimatedFirstBlock = Math.max(0, currentBlock - txCount * 100);
    const estimatedAgeSeconds = estimatedFirstBlock * 2; // ~2s per block
    const ageDays = Math.min(365, Math.floor(estimatedAgeSeconds / 86400));

    // Check balance (funded wallets with history score higher)
    const balance = await provider.getBalance(wallet);
    const hasBalance = balance > ethers.parseEther('0.001');

    // Score computation
    let score = 0;
    score += Math.min(40, txCount * 2);     // tx count: up to 40 pts
    score += Math.min(20, ageDays / 2);      // age: up to 20 pts
    score += hasBalance ? 15 : 0;            // funded: 15 pts
    score += Math.min(25, txCount > 0 ? 25 : 0); // activity: 25 pts

    score = Math.min(100, Math.round(score));

    const tier: ReputationResult['tier'] =
      score >= 80 ? 'TRUSTED' :
      score >= 60 ? 'HIGH' :
      score >= 40 ? 'MEDIUM' :
      score >= 20 ? 'LOW' : 'UNKNOWN';

    logger.info('Reputation computed', { wallet, score, tier, txCount });

    return {
      wallet,
      score,
      tier,
      txCount,
      successRate: txCount > 0 ? 1.0 : 0, // on Pharos, reverted txs still count in nonce — treat all counted txs as succeeded
      agedays: ageDays,
    };
  } catch (err) {
    logger.error('Failed to compute reputation', { wallet, error: String(err) });
    return {
      wallet,
      score: 0,
      tier: 'UNKNOWN',
      txCount: 0,
      successRate: 0,
      agedays: 0,
    };
  }
}

/**
 * Update on-chain ReputationNFT (subject to 10-event + 1hr cooldown gate)
 */
export async function updateOnChain(params: {
  agentAddress: string;
  newScore: number;
  eventsToAdd: number;
  decisionsHash: string; // keccak256 of serialized decision history
  walletConfig?: { privateKey?: string; mnemonic?: string; walletIndex?: number };
}): Promise<{ success: boolean; txHash?: string; reason?: string }> {
  const { agentAddress, newScore, eventsToAdd, decisionsHash, walletConfig } = params;

  // Check if NFT exists
  const provider = new ethers.JsonRpcProvider(process.env.PHAROS_RPC_URL);
  const nftAddress = process.env.REPUTATION_NFT_ADDRESS!;
  const nft = new ethers.Contract(nftAddress, REPUTATION_NFT_ABI, provider);

  const hasMinted = await nft.hasMinted(agentAddress);
  if (!hasMinted) {
    logger.warn('Agent has no ReputationNFT yet — mint first', { agentAddress });
    return { success: false, reason: 'No NFT minted for this agent' };
  }

  const tokenId = await nft.getTokenId(agentAddress);
  const cooldown = await nft.getCooldownRemaining(tokenId);

  if (cooldown > 0n) {
    const remaining = Number(cooldown);
    logger.info('Reputation NFT on cooldown', { tokenId: tokenId.toString(), remainingSecs: remaining });
    return { success: false, reason: `Cooldown: ${remaining}s remaining` };
  }

  if (eventsToAdd < 10) {
    return { success: false, reason: `Need 10+ events, have ${eventsToAdd}` };
  }

  // Proceed with update
  const newHashBytes = ethers.keccak256(ethers.toUtf8Bytes(decisionsHash));

  try {
    const tx = await callContract(
      nftAddress,
      REPUTATION_NFT_ABI,
      'updateDecisionHash',
      [tokenId, newHashBytes, BigInt(newScore), BigInt(eventsToAdd)],
      0n,
      walletConfig
    );

    logger.info('Reputation NFT updated on-chain', { tokenId: tokenId.toString(), txHash: tx.hash });
    return { success: true, txHash: tx.hash };
  } catch (err) {
    logger.error('Failed to update ReputationNFT', { error: String(err) });
    return { success: false, reason: String(err) };
  }
}

/**
 * Mint a new ReputationNFT for an agent (called by deployer during setup)
 */
export async function mintReputationNFT(
  agentAddress: string,
  agentType: string,
  initialScore = 50,
  walletConfig?: { privateKey?: string }
): Promise<{ tokenId: string; txHash: string }> {
  const initialHash = ethers.keccak256(ethers.toUtf8Bytes(`${agentAddress}:init`));
  const nftAddress = process.env.REPUTATION_NFT_ADDRESS!;

  const tx = await callContract(
    nftAddress,
    REPUTATION_NFT_ABI,
    'mint',
    [agentAddress, initialHash, agentType, BigInt(initialScore)],
    0n,
    walletConfig
  );

  // Parse the tokenId from the ReputationMinted event in receipt
  const provider = new ethers.JsonRpcProvider(process.env.PHAROS_RPC_URL);
  const iface = new ethers.Interface(REPUTATION_NFT_ABI);
  const receipt = await provider.getTransactionReceipt(tx.hash);
  let tokenId = '0';
  if (receipt) {
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'ReputationMinted') {
          tokenId = parsed.args[1].toString(); // tokenId is second arg
          break;
        }
      } catch {}
    }
  }

  logger.info('ReputationNFT minted', { agentAddress, tokenId, txHash: tx.hash });
  return { tokenId, txHash: tx.hash };
}
