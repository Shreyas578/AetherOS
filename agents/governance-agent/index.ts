import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { fetchProposals, summarizeProposal, runPersonaVoting, castVote } from '../../skills/governance/index';
import { createPost } from '../../skills/social/index';
import { createLogger } from '../../skills/shared/index';

const logger = createLogger('governance-agent');
const prisma = new PrismaClient();
const INTERVAL_MS = parseInt(process.env.GOVERNANCE_AGENT_INTERVAL_MS || '3600000');

async function runGovernanceCycle() {
  logger.info('=== Governance Agent Cycle Start ===');
  const agent = await prisma.agent.findFirst({ where: { type: 'GOVERNANCE' } });
  if (!agent) return;
  const cycleStart = Date.now();

  try {
    // 1. Fetch active proposals
    const proposals = await fetchProposals();
    logger.info(`Found ${proposals.length} proposals`);

    for (const proposal of proposals) {
      // Skip already processed
      const existing = await prisma.proposal.findFirst({
        where: { proposal_id_onchain: proposal.onChainId, final_vote: { not: null } },
      });
      if (existing) continue;

      // 2. Summarize if long
      const summary = await summarizeProposal(proposal.text);
      logger.info('Proposal summarized', { id: proposal.onChainId, wordCount: summary.split(' ').length });

      // 3. Run 3 persona voting
      const voting = await runPersonaVoting(summary);
      logger.info('Persona votes', {
        conservative: voting.conservative,
        growth: voting.growth,
        security: voting.security,
        consensus: voting.consensus,
      });

      // 4. Cast on-chain vote (consensus)
      let txHash: string | null = null;
      try {
        const result = await castVote(proposal.onChainId, voting.consensus as 'for' | 'against' | 'abstain', {
          walletIndex: agent.wallet_index,
        });
        txHash = result.txHash;
        logger.info('Vote cast on-chain', { txHash });
      } catch (err) {
        logger.warn('Vote casting failed (no governance contract?)', { error: String(err) });
      }

      // 5. Post rationale to social
      const rationaleText = [
        `[AetherOS Governance] Voted "${voting.consensus}" on: ${proposal.title}`,
        `Conservative: ${voting.conservative} | Growth: ${voting.growth} | Security: ${voting.security}`,
        `Rationale: ${voting.rationale.slice(0, 200)}`,
      ].join('\n');

      try {
        await createPost(rationaleText, { proposalId: proposal.onChainId, vote: voting.consensus }, {
          walletIndex: agent.wallet_index,
        });
      } catch (err) {
        logger.warn('Failed to post rationale', { error: String(err) });
      }

      // 6. Save to DB
      const stored = await prisma.proposal.upsert({
        where: { proposal_id_onchain: proposal.onChainId },
        update: {
          summary,
          votes_json: { conservative: voting.conservative, growth: voting.growth, security: voting.security },
          final_vote: voting.consensus,
          tx_hash: txHash,
          rationale: voting.rationale,
          processed_at: new Date(),
        },
        create: {
          proposal_id_onchain: proposal.onChainId,
          title: proposal.title,
          text: proposal.text,
          summary,
          votes_json: { conservative: voting.conservative, growth: voting.growth, security: voting.security },
          final_vote: voting.consensus,
          tx_hash: txHash,
          rationale: voting.rationale,
          processed_at: new Date(),
        },
      });

      await prisma.agentEvent.create({
        data: {
          agent_id: agent.id,
          event_type: 'GOVERNANCE_VOTE',
          inputs_json: { proposalId: proposal.onChainId, title: proposal.title },
          reasoning_text: [
            `Proposal: ${proposal.title}`,
            `Summary: ${summary.slice(0, 200)}`,
            `Personas: conservative=${voting.conservative}, growth=${voting.growth}, security=${voting.security}`,
            `Consensus: ${voting.consensus}`,
            `Rationale: ${voting.rationale}`,
          ].join('\n'),
          output_json: { vote: voting.consensus, proposalDbId: stored.id, txHash },
          tx_hash: txHash,
          inference_latency_ms: Date.now() - cycleStart,
          success: true,
        },
      });
    }
  } catch (err) {
    logger.error('Governance cycle error', { error: String(err) });
  }
}

async function main() {
  logger.info('Governance Agent starting...', { interval: INTERVAL_MS });
  await runGovernanceCycle();
  setInterval(runGovernanceCycle, INTERVAL_MS);
}

main().catch(err => { logger.error('Fatal', { err }); process.exit(1); });
