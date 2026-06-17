import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

const testDb = path.join(__dirname, `.test-sentiment-${Date.now()}.db`);

describe('sentiment skill', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.SQLITE_CACHE_PATH = testDb;
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
    vi.resetModules();
  });

  it('calls FinBERT service and returns sentiment', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { label: 'positive', score: 0.9, confidence: 0.85 },
    });

    const { analyzeSentiment } = await import('../sentiment/index');
    const result = await analyzeSentiment('ETH is bullish');
    expect(result.label).toBe('positive');
    expect(result.score).toBe(0.9);
    expect(result.cached).toBe(false);
  });

  it('caches results with sha256 key', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { label: 'neutral', score: 0.5, confidence: 0.7 },
    });

    const { analyzeSentiment } = await import('../sentiment/index');
    const text = 'market is flat today';
    const first = await analyzeSentiment(text);
    const second = await analyzeSentiment(text);

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('aggregates multiple sentiment results', async () => {
    const { aggregateSentiment } = await import('../sentiment/index');
    const agg = aggregateSentiment([
      { label: 'positive', score: 0.8, confidence: 0.9, text: 'a', cached: false, latencyMs: 10 },
      { label: 'negative', score: 0.6, confidence: 0.7, text: 'b', cached: false, latencyMs: 10 },
    ]);
    expect(agg.dominant).toBeDefined();
    expect(agg.avgConfidence).toBeGreaterThan(0);
  });
});
