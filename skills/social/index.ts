import { ethers } from 'ethers';
import PinataSDK from '@pinata/sdk';
import { SocialPostResult } from '../shared/types';
import { callContract } from '../wallet/index';
import { createLogger } from '../shared/index';
import 'dotenv/config';

const logger = createLogger('social');

const SOCIAL_ABI = [
  'function post(bytes32 contentHash, string calldata ipfsUri) external returns (uint256)',
  'function reply(uint256 parentId, bytes32 contentHash, string calldata ipfsUri) external returns (uint256)',
  'function tip(uint256 postId) external payable',
  'function follow(address target) external',
  'function unfollow(address target) external',
  'function getPost(uint256 postId) external view returns (tuple(uint256 id, address author, bytes32 contentHash, string ipfsUri, uint256 timestamp, uint256 tipAmount, uint256 replyCount, bool isReply, uint256 parentId))',
  'function getRecentPosts(uint256 count) external view returns (tuple(uint256 id, address author, bytes32 contentHash, string ipfsUri, uint256 timestamp, uint256 tipAmount, uint256 replyCount, bool isReply, uint256 parentId)[])',
  'function getPostCount() external view returns (uint256)',
  'function isFollowing(address follower, address target) external view returns (bool)',
  'function getFollowerCount(address user) external view returns (uint256)',
];

interface WalletConfig {
  privateKey?: string;
  mnemonic?: string;
  walletIndex?: number;
}

function getPinata(): PinataSDK {
  return new PinataSDK(
    process.env.PINATA_API_KEY!,
    process.env.PINATA_SECRET_KEY!
  );
}

function getSocialContract(signerConfig: WalletConfig = {}) {
  const address = process.env.SOCIAL_INTERACTION_ADDRESS!;
  if (!address) throw new Error('SOCIAL_INTERACTION_ADDRESS not set in env');
  return address;
}

/**
 * Upload content to IPFS via Pinata, then post on-chain
 */
export async function createPost(
  content: string,
  metadata: Record<string, unknown> = {},
  walletConfig: WalletConfig = {}
): Promise<SocialPostResult> {
  logger.info('Creating post', { contentLength: content.length });

  // Upload metadata to IPFS
  const pinata = getPinata();
  const ipfsData = {
    content,
    author: 'AetherOS',
    timestamp: Date.now(),
    ...metadata,
  };

  const ipfsResult = await pinata.pinJSONToIPFS(ipfsData, {
    pinataMetadata: { name: `aetheros-post-${Date.now()}` },
  });

  const ipfsUri = `${process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud'}/ipfs/${ipfsResult.IpfsHash}`;
  const contentHash = ethers.keccak256(ethers.toUtf8Bytes(content));

  logger.info('Content pinned to IPFS', { hash: ipfsResult.IpfsHash, uri: ipfsUri });

  const tx = await callContract(
    getSocialContract(),
    SOCIAL_ABI,
    'post',
    [contentHash, ipfsUri],
    0n,
    walletConfig
  );

  // Parse post ID from receipt logs
  const provider = new ethers.JsonRpcProvider(process.env.PHAROS_RPC_URL);
  const iface = new ethers.Interface(SOCIAL_ABI);
  const receipt = await provider.getTransactionReceipt(tx.hash);
  let postId = '0';
  if (receipt) {
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'Posted') {
          postId = parsed.args[0].toString();
          break;
        }
      } catch {}
    }
  }

  logger.info('Post created on-chain', { postId, txHash: tx.hash });
  return { postId, txHash: tx.hash, ipfsUri, contentHash };
}

/**
 * Reply to an existing post
 */
export async function replyToPost(
  parentId: string,
  content: string,
  walletConfig: WalletConfig = {}
): Promise<SocialPostResult> {
  logger.info('Replying to post', { parentId });

  const pinata = getPinata();
  const ipfsResult = await pinata.pinJSONToIPFS({
    content,
    parentId,
    timestamp: Date.now(),
  });

  const ipfsUri = `${process.env.PINATA_GATEWAY}/ipfs/${ipfsResult.IpfsHash}`;
  const contentHash = ethers.keccak256(ethers.toUtf8Bytes(content));

  const tx = await callContract(
    getSocialContract(),
    SOCIAL_ABI,
    'reply',
    [BigInt(parentId), contentHash, ipfsUri],
    0n,
    walletConfig
  );

  return { postId: '0', txHash: tx.hash, ipfsUri, contentHash };
}

/**
 * Tip a post in native PHRS
 */
export async function tipPost(
  postId: string,
  amountPhrs: string,
  walletConfig: WalletConfig = {}
): Promise<{ txHash: string }> {
  logger.info('Tipping post', { postId, amountPhrs });

  const tx = await callContract(
    getSocialContract(),
    SOCIAL_ABI,
    'tip',
    [BigInt(postId)],
    ethers.parseEther(amountPhrs),
    walletConfig
  );

  return { txHash: tx.hash };
}

/**
 * Follow an address
 */
export async function followAddress(
  target: string,
  walletConfig: WalletConfig = {}
): Promise<{ txHash: string }> {
  const tx = await callContract(
    getSocialContract(), SOCIAL_ABI, 'follow', [target], 0n, walletConfig
  );
  return { txHash: tx.hash };
}

/**
 * Unfollow an address
 */
export async function unfollowAddress(
  target: string,
  walletConfig: WalletConfig = {}
): Promise<{ txHash: string }> {
  const tx = await callContract(
    getSocialContract(), SOCIAL_ABI, 'unfollow', [target], 0n, walletConfig
  );
  return { txHash: tx.hash };
}

/**
 * Fetch recent posts from the social contract (read-only)
 */
export async function getRecentPosts(count = 20): Promise<Array<{
  id: string;
  author: string;
  ipfsUri: string;
  timestamp: number;
  tipAmount: string;
  replyCount: number;
}>> {
  const provider = new ethers.JsonRpcProvider(process.env.PHAROS_RPC_URL);
  const contract = new ethers.Contract(getSocialContract(), SOCIAL_ABI, provider);

  const posts = await contract.getRecentPosts(count);
  return posts.map((p: { id: bigint; author: string; ipfsUri: string; timestamp: bigint; tipAmount: bigint; replyCount: bigint }) => ({
    id: p.id.toString(),
    author: p.author,
    ipfsUri: p.ipfsUri,
    timestamp: Number(p.timestamp) * 1000,
    tipAmount: ethers.formatEther(p.tipAmount),
    replyCount: Number(p.replyCount),
  }));
}
