import { describe, it, expect } from 'vitest';
import { computeRiskScore } from '../risk-scorer/index';

describe('risk-scorer skill', () => {
  const baseParams = {
    currentPriceUsd: 3500,
    tradeValueUsd: 100,
    portfolioValueUsd: 10000,
    liquidityDepthUsd: 500_000,
    priceHistory: Array.from({ length: 24 }, (_, i) => 3400 + i * 5),
    sentimentScore: 0.2,
    sentimentConfidence: 0.8,
    sourceReputationScore: 70,
  };

  it('approves low-risk trades', () => {
    const result = computeRiskScore(baseParams);
    expect(result.score).toBeLessThan(70);
    expect(result.approved).toBe(true);
    expect(result.grade).toMatch(/LOW|MEDIUM/);
  });

  it('blocks high-risk oversized trades', () => {
    const result = computeRiskScore({
      ...baseParams,
      tradeValueUsd: 9000,
      portfolioValueUsd: 10000,
      liquidityDepthUsd: 500,
      priceHistory: [3500, 2000, 1500, 1000],
      sentimentScore: 0.95,
      sentimentConfidence: 0.1,
      sourceReputationScore: 5,
    });
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.approved).toBe(false);
    expect(result.reason).toContain('BLOCKED');
  });
});
