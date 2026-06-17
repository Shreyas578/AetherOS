import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { ethers } from 'ethers';
import { createLogger } from '../skills/shared/index';

const logger = createLogger('seed');
const prisma = new PrismaClient();

const AGENT_REGISTRY_ABI = [
  'function registerAgent(address agent, bytes32 metadataHash, string calldata agentType) external',
  'function isRegistered(address) external view returns (bool)',
];
const REPUTATION_NFT_ABI = [
  'function mint(address agent, bytes32 initialHash, string calldata agentType, uint256 initialScore) external returns (uint256)',
  'function hasMinted(address) external view returns (bool)',
  'event ReputationMinted(address indexed agent, uint256 tokenId, string agentType, uint256 timestamp)',
];

function deriveWallet(index: number) {
  const mnemonic = process.env.AGENT_MNEMONIC!;
  return ethers.HDNodeWallet.fromMnemonic(
    ethers.Mnemonic.fromPhrase(mnemonic),
    `m/44'/60'/0'/0/${index}`
  );
}

const AGENTS = [
  { name: 'trading-agent',    type: 'TRADING',          index: 1, initialScore: 50 },
  { name: 'social-agent',     type: 'SOCIAL',           index: 2, initialScore: 50 },
  { name: 'governance-agent', type: 'GOVERNANCE',       index: 3, initialScore: 50 },
  { name: 'budget-allocator', type: 'BUDGET_ALLOCATOR', index: 4, initialScore: 60 },
  { name: 'attacker-agent',   type: 'ATTACKER',         index: 99, initialScore: 10 },
];

async function seed() {
  logger.info('Starting database seed...');

  const provider = new ethers.JsonRpcProvider(process.env.PHAROS_RPC_URL);
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  const deployer = deployerKey ? new ethers.Wallet(deployerKey, provider) : null;

  const registryAddress = process.env.AGENT_REGISTRY_ADDRESS;
  const nftAddress = process.env.REPUTATION_NFT_ADDRESS;

  for (const agentDef of AGENTS) {
    const wallet = deriveWallet(agentDef.index);
    logger.info(`Seeding agent: ${agentDef.name}`, { address: wallet.address });

    // Upsert in DB
    const agent = await prisma.agent.upsert({
      where: { name: agentDef.name },
      update: { wallet_address: wallet.address, wallet_index: agentDef.index },
      create: {
        name: agentDef.name,
        type: agentDef.type as 'TRADING' | 'SOCIAL' | 'GOVERNANCE' | 'BUDGET_ALLOCATOR' | 'ATTACKER',
        wallet_address: wallet.address,
        wallet_index: agentDef.index,
        reputation_score: agentDef.initialScore,
        budget_phrs: agentDef.type === 'BUDGET_ALLOCATOR' ? 0 : 2.0,
      },
    });

    logger.info(`Agent ${agentDef.name} upserted`, { id: agent.id, address: wallet.address });

    // Register on-chain if contracts deployed
    if (deployer && registryAddress) {
      try {
        const registry = new ethers.Contract(registryAddress, AGENT_REGISTRY_ABI, deployer);
        const isReg = await registry.isRegistered(wallet.address);
        if (!isReg) {
          const metaHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify({ name: agentDef.name, type: agentDef.type })));
          const tx = await registry.registerAgent(wallet.address, metaHash, agentDef.type);
          await tx.wait();
          logger.info(`Registered ${agentDef.name} in AgentRegistry`, { txHash: tx.hash });
        }
      } catch (err) {
        logger.warn(`Failed to register ${agentDef.name} on-chain`, { error: String(err) });
      }
    }

    // Mint ReputationNFT
    if (deployer && nftAddress) {
      try {
        const nft = new ethers.Contract(nftAddress, REPUTATION_NFT_ABI, deployer);
        const hasMinted = await nft.hasMinted(wallet.address);
        if (!hasMinted) {
          const initHash = ethers.keccak256(ethers.toUtf8Bytes(`${agentDef.name}:init`));
          const tx = await nft.mint(wallet.address, initHash, agentDef.type, BigInt(agentDef.initialScore));
          const receipt = await tx.wait();
          logger.info(`Minted ReputationNFT for ${agentDef.name}`, { txHash: receipt.hash });

          // Parse actual tokenId from ReputationMinted event
          const iface = new ethers.Interface(REPUTATION_NFT_ABI);
          let tokenId = 1;
          for (const log of receipt.logs) {
            try {
              const parsed = iface.parseLog(log);
              if (parsed?.name === 'ReputationMinted') {
                tokenId = Number(parsed.args[1]);
                break;
              }
            } catch {}
          }
          await prisma.agent.update({ where: { id: agent.id }, data: { reputation_nft_token_id: tokenId } });
          logger.info(`TokenId ${tokenId} saved for ${agentDef.name}`);
        }
      } catch (err) {
        logger.warn(`Failed to mint NFT for ${agentDef.name}`, { error: String(err) });
      }
    }
  }

  logger.info('Database seed complete!');
  logger.info('Agent wallets:');
  for (const agentDef of AGENTS) {
    const w = deriveWallet(agentDef.index);
    console.log(`  ${agentDef.name.padEnd(20)} ${w.address}`);
  }

  await prisma.$disconnect();
}

seed().catch(err => {
  logger.error('Seed failed', { error: String(err) });
  process.exit(1);
});
