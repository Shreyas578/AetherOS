import { RiskScore } from '../shared/types';
import { createLogger } from '../shared/index';

const logger = createLogger('risk-scorer');

const MAX_RISK_SCORE = parseInt(process.env.MAX_RISK_SCORE || '70');
const MAX_POSITION_PCT = parseFloat(process.env.MAX_POSITION_PCT || '0.05');

export interface RiskScorerParams {
  // Price/liquidity data
  currentPriceUsd: number;
  tradeValueUsd: number;          // size of the trade
  portfolioValueUsd: number;      // total portfolio value
  liquidityDepthUsd?: number;     // total pool liquidity

  // Volatility (rolling window stddev)
  priceHistory: number[];         // at least 24 data points (1h intervals)

  // Sentiment
  sentimentScore?: number;        // -1 to 1
  sentimentConfidence?: number;   // 0-1

  // Reputation of signal source
  sourceReputationScore?: number; // 0-100
}

/**
 * Compute a 0-100 risk score for a potential trade
 * Lower score = lower risk = safer to execute
 */
export function computeRiskScore(params: RiskScorerParams): RiskScore {
  const {
    currentPriceUsd,
    tradeValueUsd,
    portfolioValueUsd,
    liquidityDepthUsd = 100_000,
    priceHistory,
    sentimentScore = 0,
    sentimentConfidence = 0.5,
    sourceReputationScore = 50,
  } = params;

  // ── 1. Position Size Risk (0-100) ──────────────────────────────────────────
  const positionPct = portfolioValueUsd > 0 ? tradeValueUsd / portfolioValueUsd : 1;
  const positionSizePct = Math.min(100, (positionPct / MAX_POSITION_PCT) * 50);

  // ── 2. Slippage Estimate Risk (0-100) ──────────────────────────────────────
  // Estimate slippage = tradeValue / (2 * liquidityDepth) * 100
  const slippagePct = liquidityDepthUsd > 0
    ? (tradeValueUsd / (2 * liquidityDepthUsd)) * 100
    : 100;
  const slippageRisk = Math.min(100, slippagePct * 20); // 5% slippage = 100 risk

  // ── 3. Liquidity Depth Check (0-100) ──────────────────────────────────────
  // Low liquidity = high risk
  const liquidityDepth = liquidityDepthUsd > 0
    ? Math.max(0, 100 - Math.log10(liquidityDepthUsd) * 15)
    : 100;

  // ── 4. Volatility Risk (0-100) ─────────────────────────────────────────────
  const volatilityScore = computeVolatility(priceHistory, currentPriceUsd);

  // ── 5. Sentiment Risk (0-100) ─────────────────────────────────────────────
  // Very positive sentiment with low confidence = risky (could be fake)
  const sentimentRisk = computeSentimentRisk(sentimentScore, sentimentConfidence);

  // ── 6. Reputation Risk (0-100) ────────────────────────────────────────────
  // Low reputation of signal source = high risk
  const reputationRisk = Math.max(0, 100 - sourceReputationScore);

  // ── Weighted Composite Score ───────────────────────────────────────────────
  const score = Math.round(
    positionSizePct   * 0.25 +
    slippageRisk      * 0.20 +
    liquidityDepth    * 0.15 +
    volatilityScore   * 0.20 +
    sentimentRisk     * 0.10 +
    reputationRisk    * 0.10
  );

  const finalScore = Math.min(100, Math.max(0, score));
  const grade =
    finalScore < 25 ? 'LOW' :
    finalScore < 50 ? 'MEDIUM' :
    finalScore < 75 ? 'HIGH' : 'CRITICAL';

  const approved = finalScore < MAX_RISK_SCORE;
  const reason = buildReason(finalScore, approved, {
    positionSizePct, slippageRisk, liquidityDepth,
    volatilityScore, sentimentRisk, reputationRisk,
  });

  logger.info('Risk score computed', { score: finalScore, grade, approved });

  return {
    score: finalScore,
    grade,
    breakdown: {
      slippageRisk: Math.round(slippageRisk),
      liquidityDepth: Math.round(liquidityDepth),
      positionSizePct: Math.round(positionSizePct),
      volatilityScore: Math.round(volatilityScore),
      sentimentRisk: Math.round(sentimentRisk),
      reputationRisk: Math.round(reputationRisk),
    },
    approved,
    reason,
  };
}

function computeVolatility(prices: number[], currentPrice: number): number {
  if (prices.length < 2) return 50; // insufficient data = medium risk
  const all = [...prices, currentPrice];
  const returns = all.slice(1).map((p, i) => (p - all[i]) / all[i]);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / returns.length;
  const stddev = Math.sqrt(variance);
  // 5% daily stddev → risk score 50; normalize to 0-100
  return Math.min(100, (stddev / 0.05) * 50);
}

function computeSentimentRisk(sentimentScore: number, confidence: number): number {
  // Strongly bullish with low confidence = highest risk (could be manipulation)
  const extremism = Math.abs(sentimentScore); // 0-1
  const uncertainty = 1 - confidence;        // 0-1
  return Math.round(extremism * uncertainty * 100);
}

function buildReason(
  score: number,
  approved: boolean,
  breakdown: Record<string, number>
): string {
  const topFactors = Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');

  return approved
    ? `Trade approved (risk=${score}/100). Top factors: ${topFactors}.`
    : `Trade BLOCKED (risk=${score}/100 exceeds threshold ${MAX_RISK_SCORE}). Top factors: ${topFactors}.`;
}
