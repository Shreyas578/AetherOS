import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { ethers } from 'ethers';
import { getPrice } from '../../skills/price-oracle/index';
import { analyzeSentiment, aggregateSentiment } from '../../skills/sentiment/index';
import { computeRiskScore } from '../../skills/risk-scorer/index';
import { computeReputation, updateOnChain } from '../../skills/reputation/index';
import { createLogger } from '../../skills/shared/index';

const logger = createLogger('trading-agent');
const prisma = new PrismaClient();

const FORECAST_URL = process.env.FORECAST_SERVICE_URL || 'http://localhost:8002';
const RL_URL       = process.env.RL_POLICY_SERVICE_URL || 'http://localhost:8003';
const INTERVAL_MS  = parseInt(process.env.TRADING_AGENT_INTERVAL_MS || '60000'); // 1 min default

// Multi-token support — PHRS first (hackathon priority), then majors
const TRADING_TOKENS = (process.env.TRADING_TOKENS || 'ETH,BTC,SOL,BNB,MATIC,AVAX,PHRS').split(',');

// Per-token price history buffer (last 48 1h candles each)
const priceHistories: Record<string, number[]> = {};
for (const t of TRADING_TOKENS) priceHistories[t] = [];

async function getAgentFromDB() {
  return prisma.agent.findFirst({ where: { type: 'TRADING' } });
}

async function getForecast(token: string, prices: number[], timestamps: number[]) {
  const resp = await axios.post(`${FORECAST_URL}/forecast`, {
    token,
    prices,
    timestamps,
    horizon_hours: 24,
  }, { timeout: 30000 });
  return {
    forecastedPrice: resp.data.forecasted_price as number,
    confidence:      resp.data.confidence      as number,
    direction:       resp.data.direction        as string,
    model:           resp.data.model            as string,
  };
}

async function getRLAction(obs: {
  price: number; sentiment: number; forecast: number;
  portfolio: number; volatility: number;
}) {
  const resp = await axios.post(`${RL_URL}/predict`, obs, { timeout: 10000 });
  return {
    action:      resp.data.action       as number,
    actionLabel: resp.data.action_label as string,
    confidence:  resp.data.confidence   as number,
  };
}

async function runTokenCycle(token: string, agent: NonNullable<Awaited<ReturnType<typeof getAgentFromDB>>>) {
  const cycleStart = Date.now();
  let txHash: string | null = null;

  // Skip stablecoins / zero-price / unavailable tokens gracefully
  let priceData;
  try {
    priceData = await getPrice(token);
  } catch (err) {
    logger.warn(`${token}: price unavailable, skipping cycle`, { error: String(err) });
    return;
  }
  const currentPrice = priceData.priceUsd;

  // Skip stablecoins / zero-price tokens
  if (currentPrice <= 0) {
    logger.warn(`Skipping ${token} — price unavailable or zero`);
    return;
  }

  const hist = priceHistories[token];
  hist.push(currentPrice);
  if (hist.length > 48) hist.shift();

  const timestamps = hist.map((_, i) =>
    Date.now() - (hist.length - 1 - i) * 3600000
  );

  logger.info('Price fetched', { token, price: currentPrice, source: priceData.source });

  // 2. Sentiment Analysis
  const sentimentSources = [
    `${token} price action: ${priceData.change24h?.toFixed(2) || '0'}% change today`,
    `Market outlook for ${token} at $${currentPrice.toFixed(4)}`,
  ];
  const sentimentResults = await Promise.all(sentimentSources.map(s => analyzeSentiment(s)));
  const { aggregate: sentimentAggregate, avgConfidence: sentimentConfidence } = aggregateSentiment(sentimentResults);
  logger.info('Sentiment analyzed', { token, aggregate: sentimentAggregate, confidence: sentimentConfidence });

  // 3. Forecast (need at least 2 points)
  if (hist.length < 2) {
    logger.info(`${token}: not enough price history yet (${hist.length} pts), skipping forecast`);
    return;
  }
  const forecast = await getForecast(token, hist, timestamps);
  logger.info('Forecast received', { token, ...forecast });

  // 4. Volatility
  let volatility = 0.3;
  if (hist.length >= 2) {
    const returns = hist.slice(1).map((p, i) => (p - hist[i]) / hist[i]);
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / returns.length;
    volatility = Math.min(1, Math.sqrt(variance) / 0.05);
  }

  // 5. RL Policy Decision
  const provider = new ethers.JsonRpcProvider(process.env.PHAROS_RPC_URL);
  const walletBalanceEth = parseFloat(ethers.formatEther(await provider.getBalance(agent.wallet_address)));
  // Rough USD estimate using ETH price for PHRS testnet balance
  const portfolioUsd = walletBalanceEth * (currentPrice / 1) || 100;

  const rlAction = await getRLAction({
    price:     currentPrice,
    sentiment: sentimentAggregate,
    forecast:  forecast.forecastedPrice,
    portfolio: portfolioUsd,
    volatility,
  });
  logger.info('RL action', { token, ...rlAction });

  // 6. Risk Score
  const sourceRep = await computeReputation(agent.wallet_address);
  const riskScore = computeRiskScore({
    currentPriceUsd:    currentPrice,
    tradeValueUsd:      portfolioUsd * 0.02,
    portfolioValueUsd:  portfolioUsd,
    priceHistory:       hist,
    sentimentScore:     sentimentAggregate,
    sentimentConfidence,
    sourceReputationScore: sourceRep.score,
  });
  logger.info('Risk score computed', { token, score: riskScore.score, approved: riskScore.approved });

  // 7. Decision
  let decision = 'HOLD';
  let reasoning = `RL: ${rlAction.actionLabel}, Risk: ${riskScore.score}/100`;

  if (rlAction.actionLabel !== 'HOLD' && riskScore.approved) {
    reasoning += ` — APPROVED: executing ${rlAction.actionLabel}`;
    decision = rlAction.actionLabel;
    // On-chain swap intentionally omitted — no DEX on Pharos Atlantic testnet
    logger.info(`TRADE DECISION: ${decision} ${token} @ $${currentPrice.toFixed(4)} — swap pending DEX`);
  } else if (!riskScore.approved) {
    reasoning += ` — BLOCKED: ${riskScore.reason}`;
    logger.warn('Trade blocked by risk scorer', { token, reason: riskScore.reason });
  }

  // 8. Log to DB
  const event = await prisma.agentEvent.create({
    data: {
      agent_id:   agent.id,
      event_type: 'TRADING_CYCLE',
      inputs_json: {
        token,
        price:           currentPrice,
        sentiment:       sentimentAggregate,
        forecastDirection: forecast.direction,
        forecastedPrice: forecast.forecastedPrice,
        rlAction:        rlAction.actionLabel,
        riskScore:       riskScore.score,
        volatility,
      },
      reasoning_text: [
        `Token: ${token}`,
        `Price: $${currentPrice.toFixed(4)} (${priceData.source})`,
        `24h Change: ${priceData.change24h?.toFixed(2) || 'n/a'}%`,
        `Sentiment: ${sentimentAggregate.toFixed(3)} (conf: ${sentimentConfidence.toFixed(3)})`,
        `Forecast: ${forecast.direction} → $${forecast.forecastedPrice.toFixed(4)} (${forecast.model}, conf: ${forecast.confidence.toFixed(3)})`,
        `Volatility: ${(volatility * 100).toFixed(1)}%`,
        `RL Policy: ${rlAction.actionLabel} (conf: ${rlAction.confidence.toFixed(3)})`,
        `Risk Score: ${riskScore.score}/100 [${riskScore.grade}]`,
        `Decision: ${decision}`,
        `Reason: ${reasoning}`,
      ].join('\n'),
      output_json: {
        token, decision, txHash,
        riskScore:      riskScore.score,
        riskBreakdown:  riskScore.breakdown,
        forecast,
        priceHistory:   hist.slice(-12), // last 12 points for charts
        sentiment:      sentimentAggregate,
      },
      tx_hash:              txHash,
      cache_hit:            sentimentResults.some(s => s.cached),
      inference_latency_ms: Date.now() - cycleStart,
      success: true,
    },
  });

  logger.info('Event logged', { token, eventId: event.id, decision, latencyMs: Date.now() - cycleStart });

  // 9. ReputationNFT update gate (every 10 events + 1hr cooldown)
  const newCount = agent.reputation_event_count + 1;
  await prisma.agent.update({ where: { id: agent.id }, data: { reputation_event_count: newCount } });

  if (newCount >= 10 && agent.reputation_nft_token_id) {
    const lastUpdate = agent.last_reputation_update;
    const oneHourAgo = new Date(Date.now() - 3600000);
    if (!lastUpdate || lastUpdate < oneHourAgo) {
      const decisionsHash = ethers.keccak256(ethers.toUtf8Bytes(`${agent.id}:${newCount}:${Date.now()}`));
      const updateResult = await updateOnChain({
        agentAddress:  agent.wallet_address,
        newScore:      Math.round(sourceRep.score),
        eventsToAdd:   newCount,
        decisionsHash,
        walletConfig:  { walletIndex: agent.wallet_index },
      });
      if (updateResult.success) {
        await prisma.agent.update({
          where: { id: agent.id },
          data: { reputation_event_count: 0, last_reputation_update: new Date(), reputation_score: sourceRep.score },
        });
        logger.info('ReputationNFT updated on-chain', { txHash: updateResult.txHash });
      }
    }
  }
}

async function runTradingCycle() {
  logger.info('=== Trading Agent Cycle Start ===', { tokens: TRADING_TOKENS });
  const agent = await getAgentFromDB();
  if (!agent) { logger.error('Trading agent not found in DB — run seed first'); return; }

  // Process each token sequentially with delay to avoid CoinGecko rate limiting (free: 10 req/min)
  for (const token of TRADING_TOKENS) {
    try {
      await runTokenCycle(token, agent);
      // 8s gap between tokens = ~7.5 req/min, safely under free tier limit
      await new Promise(r => setTimeout(r, 8000));
    } catch (err) {
      logger.error(`Error on ${token}`, { error: String(err) });
      await prisma.agentEvent.create({
        data: {
          agent_id:       agent.id,
          event_type:     'TRADING_CYCLE_ERROR',
          inputs_json:    { token },
          reasoning_text: `${token}: ${String(err)}`,
          output_json:    { error: String(err), token },
          success:        false,
          error_message:  String(err),
        },
      });
    }
  }

  logger.info('=== Trading Agent Cycle Complete ===');
}

async function main() {
  logger.info('Trading Agent starting...', { tokens: TRADING_TOKENS, interval: INTERVAL_MS });
  await runTradingCycle();
  setInterval(runTradingCycle, INTERVAL_MS);
}

main().catch(err => {
  logger.error('Fatal error', { error: String(err) });
  process.exit(1);
});
