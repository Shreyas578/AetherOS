import { ethers } from 'ethers';
import { GovernanceProposal } from '../shared/types';
import { callContract } from '../wallet/index';
import { reason as llmReason } from '../llm-reasoning/index';
import { createLogger } from '../shared/index';
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const logger = createLogger('governance');
const prisma = new PrismaClient();

const GOVERNANCE_ABI = [
  'event ProposalCreated(uint256 indexed proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description)',
  'function castVote(uint256 proposalId, uint8 support) external returns (uint256)',
  'function state(uint256 proposalId) external view returns (uint8)',
];

const VOTE_SUPPORT: Record<string, number> = { for: 1, against: 0, abstain: 2 };

export async function fetchProposals(): Promise<GovernanceProposal[]> {
  logger.info('Fetching governance proposals');
  const stored = await prisma.proposal.findMany({
    where: { final_vote: null },
    orderBy: { created_at: 'desc' },
    take: 10,
  });

  if (stored.length > 0) {
    return stored.map(p => ({
      id: p.id.toString(),
      onChainId: p.proposal_id_onchain,
      title: p.title,
      text: p.text,
      summary: p.summary ?? undefined,
      status: 'active' as const,
    }));
  }

  const provider = new ethers.JsonRpcProvider(process.env.PHAROS_RPC_URL);
  const govAddress = process.env.GOVERNANCE_CONTRACT_ADDRESS;
  if (!govAddress) return [];

  const iface = new ethers.Interface(GOVERNANCE_ABI);
  const currentBlock = await provider.getBlockNumber();
  const logs = await provider.getLogs({
    address: govAddress,
    topics: [iface.getEvent('ProposalCreated')!.topicHash],
    fromBlock: Math.max(0, currentBlock - 5000),
    toBlock: currentBlock,
  });

  return logs.map(log => {
    const parsed = iface.parseLog(log);
    if (!parsed) return null;
    const proposalId = parsed.args[0].toString();
    const description = parsed.args[8] as string;
    return { id: proposalId, onChainId: proposalId, title: description.slice(0, 100), text: description, status: 'active' as const };
  }).filter(Boolean) as GovernanceProposal[];
}

/** Rough token estimate (~4 chars per token) */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function summarizeProposal(text: string): Promise<string> {
  const tokenCount = estimateTokens(text);
  if (tokenCount <= 500) return text;
  logger.info('Summarizing long proposal', { tokenCount });
  const result = await llmReason<{ summary: string }>(`Summarize this governance proposal in 3-5 sentences:\n\n${text}`, { summary: 'string' });
  return result.data.summary || text.slice(0, 500) + '...';
}

export async function runPersonaVoting(proposalText: string): Promise<{
  conservative: string; growth: string; security: string; consensus: string; rationale: string;
}> {
  const personas: Record<string, string> = {
    conservative: 'You are a conservative governance voter who prioritizes stability and low risk.',
    growth: 'You are a growth-oriented voter who supports ambitious ecosystem expansion.',
    security: 'You are a security-focused voter who requires audits and safe implementation.',
  };

  const votes: Array<[string, string, string]> = [];
  for (const [persona, context] of Object.entries(personas)) {
    const result = await llmReason<{ vote: string; reasoning: string }>(
      `${context}\n\nProposal: ${proposalText}\n\nVote (for|against|abstain) and give 1-sentence reasoning.`,
      { vote: 'string', reasoning: 'string' }
    );
    votes.push([persona, (result.data.vote || 'abstain').toLowerCase(), result.data.reasoning || '']);
  }

  const voteMap = Object.fromEntries(votes.map(([p, v]) => [p, v]));
  const forCount = Object.values(voteMap).filter(v => v === 'for').length;
  const againstCount = Object.values(voteMap).filter(v => v === 'against').length;
  const consensus = forCount > againstCount ? 'for' : againstCount > forCount ? 'against' : 'abstain';
  const rationale = votes.map(([p, v, r]) => `${p}: ${v} — ${r}`).join(' | ');

  return { conservative: voteMap['conservative'] || 'abstain', growth: voteMap['growth'] || 'abstain', security: voteMap['security'] || 'abstain', consensus, rationale };
}

export async function castVote(proposalId: string, vote: 'for' | 'against' | 'abstain', walletConfig?: { privateKey?: string; mnemonic?: string; walletIndex?: number }): Promise<{ txHash: string }> {
  const govAddress = process.env.GOVERNANCE_CONTRACT_ADDRESS;
  if (!govAddress) throw new Error('GOVERNANCE_CONTRACT_ADDRESS not set');
  const tx = await callContract(govAddress, GOVERNANCE_ABI, 'castVote', [BigInt(proposalId), VOTE_SUPPORT[vote]], 0n, walletConfig);
  return { txHash: tx.hash };
}
