/**
 * AetherOS Adversarial Test
 * 1. Starts attacker-agent (posts fake bullish content)
 * 2. Checks that trading agent's risk-scorer + reputation skill
 *    correctly blocked/discounted the fake signal
 * 3. Asserts trade was NOT executed on fake data
 * Exit 0 = PASS, Exit 1 = FAIL
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { runAttackerCycles } from '../agents/attacker-agent/index';
import { computeRiskScore } from '../skills/risk-scorer/index';
import { computeReputation } from '../skills/reputation/index';
import { analyzeSentiment } from '../skills/sentiment/index';
import { createLogger } from '../skills/shared/index';

const logger = createLogger('adversarial-test');
const prisma = new PrismaClient();

const FAKE_MESSAGES = [
  'ETH is about to 10x! I have insider info — this is the biggest pump of the year! BUY NOW!',
  'MASSIVE whale just bought 50,000 ETH! Bullish signal confirmed! MOON IMMINENT!',
];

async function runAdversarialTest() {
  logger.warn('=== ADVERSARIAL TEST STARTING ===');
  let passed = true;
  const results: Array<{ test: string; passed: boolean; details: string }> = [];

  // ── Test 1: Fake content sentiment analysis ──────────────────────────────
  logger.info('Test 1: Fake bullish content → high sentiment score...');
  for (const msg of FAKE_MESSAGES) {
    const sentiment = await analyzeSentiment(msg);
    const isPositive = sentiment.label === 'positive' && sentiment.score > 0.7;
    results.push({
      test: 'Fake content IS detected as positive',
      passed: isPositive,
      details: `label=${sentiment.label}, score=${sentiment.score.toFixed(3)}`,
    });
  }

  // ── Test 2: New/unknown wallet has LOW reputation ────────────────────────
  logger.info('Test 2: New attacker wallet → low reputation score...');
  // Use a fresh address (likely no tx history)
  const freshWallet = '0x000000000000000000000000000000000000dead';
  const attackerRep = await computeReputation(freshWallet);
  const lowRep = attackerRep.score < 30;
  results.push({
    test: 'Attacker wallet has LOW reputation (< 30)',
    passed: lowRep,
    details: `score=${attackerRep.score}, tier=${attackerRep.tier}`,
  });

  // ── Test 3: Risk scorer BLOCKS trade when source reputation is low ────────
  logger.info('Test 3: Risk scorer blocks trade from low-rep source...');
  const riskResult = computeRiskScore({
    currentPriceUsd: 3000,
    tradeValueUsd: 500,
    portfolioValueUsd: 10000,
    liquidityDepthUsd: 50000,
    priceHistory: Array.from({ length: 24 }, (_, i) => 3000 + i * 10),
    sentimentScore: 0.95,       // very bullish (fake)
    sentimentConfidence: 0.85,
    sourceReputationScore: attackerRep.score, // low rep attacker
  });

  results.push({
    test: 'Risk scorer BLOCKS trade from low-rep source',
    passed: !riskResult.approved,
    details: `score=${riskResult.score}/100, grade=${riskResult.grade}, approved=${riskResult.approved}, reason=${riskResult.reason}`,
  });

  // ── Test 4: Risk scorer BLOCKS high-sentiment + low-confidence combo ─────
  logger.info('Test 4: High sentiment + low confidence → high sentimentRisk...');
  const riskLowConf = computeRiskScore({
    currentPriceUsd: 3000,
    tradeValueUsd: 500,
    portfolioValueUsd: 10000,
    priceHistory: Array.from({ length: 24 }, (_, i) => 3000 + i * 5),
    sentimentScore: 0.98,        // extreme bullish
    sentimentConfidence: 0.10,   // very low confidence (suspicious)
    sourceReputationScore: 20,
  });

  results.push({
    test: 'Extreme sentiment + low confidence → HIGH sentimentRisk',
    passed: riskLowConf.breakdown.sentimentRisk > 50,
    details: `sentimentRisk=${riskLowConf.breakdown.sentimentRisk}/100`,
  });

  // ── Test 5: DB check — no trade executed while attacker was posting ───────
  logger.info('Test 5: Running attacker cycles, checking no trade executed...');
  await runAttackerCycles(2);
  await new Promise(r => setTimeout(r, 5000)); // wait 5s

  const recentTrades = await prisma.agentEvent.findMany({
    where: {
      event_type: 'TRADING_CYCLE',
      timestamp: { gte: new Date(Date.now() - 30000) },
    },
    orderBy: { timestamp: 'desc' },
    take: 5,
  });

  const tradesExecuted = recentTrades.filter(e => {
    const output = e.output_json as Record<string, unknown>;
    return output?.decision === 'BUY' || output?.decision === 'SELL';
  });

  results.push({
    test: 'No trade executed during attacker window',
    passed: tradesExecuted.length === 0,
    details: `tradesExecuted=${tradesExecuted.length} in last 30s`,
  });

  // ── Results Report ────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('  AetherOS Adversarial Test Results');
  console.log('='.repeat(60));
  for (const result of results) {
    const icon = result.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${icon}  ${result.test}`);
    console.log(`        → ${result.details}`);
  }
  console.log('='.repeat(60));

  const allPassed = results.every(r => r.passed);
  if (allPassed) {
    console.log('\n  🛡️  ALL TESTS PASSED — Trading agent correctly defended against fake signals\n');
  } else {
    const failCount = results.filter(r => !r.passed).length;
    console.log(`\n  ⚠️  ${failCount} TEST(S) FAILED — Review risk scorer configuration\n`);
    passed = false;
  }

  await prisma.$disconnect();
  process.exit(passed ? 0 : 1);
}

runAdversarialTest().catch(err => {
  logger.error('Test crashed', { error: String(err) });
  process.exit(1);
});
