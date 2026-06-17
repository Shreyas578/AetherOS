import 'dotenv/config';
import { PrismaClient, AgentType } from '@prisma/client';
import { createLogger } from '../../skills/shared/index';

const logger = createLogger('budget-allocator');
const prisma = new PrismaClient();
const INTERVAL_MS = parseInt(process.env.BUDGET_ALLOCATOR_INTERVAL_MS || '86400000');

const TOTAL_BUDGET_PHRS = 10.0; // 10 PHRS total daily budget pool

async function runBudgetAllocation() {
  logger.info('=== Budget Allocator Cycle Start ===');

  try {
    const agents = await prisma.agent.findMany({
      where: { is_active: true, type: { not: 'BUDGET_ALLOCATOR' as AgentType } },
    });

    if (agents.length === 0) {
      logger.warn('No active agents found');
      return;
    }

    const since24h = new Date(Date.now() - 86400000);

    // Compute per-agent metrics
    const metrics = await Promise.all(agents.map(async agent => {
      const events = await prisma.agentEvent.findMany({
        where: { agent_id: agent.id, timestamp: { gte: since24h } },
      });

      const totalEvents = events.length;
      const successEvents = events.filter(e => e.success).length;
      const txEvents = events.filter(e => e.tx_hash !== null).length;
      const totalGas = events.reduce((sum, e) => sum + Number(e.gas_used || 0), 0);
      const successRate = totalEvents > 0 ? successEvents / totalEvents : 0;

      // Performance score: weighted combination
      const performanceScore =
        (successRate * 40) +
        (Math.min(txEvents / 10, 1) * 30) +
        (Math.min(totalEvents / 20, 1) * 30);

      return { agent, totalEvents, successRate, txEvents, totalGas, performanceScore };
    }));

    // Proportional allocation
    const totalScore = metrics.reduce((sum, m) => sum + m.performanceScore, 0);
    const allocations = metrics.map(m => ({
      agentId: m.agent.id,
      agentName: m.agent.name,
      performanceScore: m.performanceScore,
      allocatedPhrs: totalScore > 0
        ? (m.performanceScore / totalScore) * TOTAL_BUDGET_PHRS
        : TOTAL_BUDGET_PHRS / agents.length,
    }));

    logger.info('Budget allocations computed', {
      totalBudget: TOTAL_BUDGET_PHRS,
      allocations: allocations.map(a => ({ name: a.agentName, phrs: a.allocatedPhrs.toFixed(4), score: a.performanceScore.toFixed(1) })),
    });

    // Update DB
    for (const alloc of allocations) {
      await prisma.agent.update({
        where: { id: alloc.agentId },
        data: { budget_phrs: alloc.allocatedPhrs },
      });
    }

    // Log the allocation event
    const allocatorAgent = await prisma.agent.findFirst({ where: { type: 'BUDGET_ALLOCATOR' } });
    if (allocatorAgent) {
      await prisma.agentEvent.create({
        data: {
          agent_id: allocatorAgent.id,
          event_type: 'BUDGET_ALLOCATION',
          inputs_json: { agentCount: agents.length, totalBudgetPhrs: TOTAL_BUDGET_PHRS },
          reasoning_text: allocations.map(a =>
            `${a.agentName}: score=${a.performanceScore.toFixed(1)}, budget=${a.allocatedPhrs.toFixed(4)} PHRS`
          ).join('\n'),
          output_json: { allocations },
          success: true,
        },
      });
    }

  } catch (err) {
    logger.error('Budget allocation error', { error: String(err) });
  }
}

async function main() {
  logger.info('Budget Allocator starting...', { interval: INTERVAL_MS });
  await runBudgetAllocation();
  setInterval(runBudgetAllocation, INTERVAL_MS);
}

main().catch(err => { logger.error('Fatal', { err }); process.exit(1); });
