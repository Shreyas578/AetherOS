import axios from 'axios';
import { SentimentResult } from '../shared/types';
import { MLCache, createLogger } from '../shared/index';
import 'dotenv/config';

const logger = createLogger('sentiment');
const cache = new MLCache();

const SERVICE_URL = process.env.SENTIMENT_SERVICE_URL || 'http://localhost:8001';
const TTL = parseInt(process.env.CACHE_TTL_SENTIMENT || '300');

/**
 * Analyze sentiment of text using local FinBERT service
 * Returns label (positive/negative/neutral), score, confidence
 */
export async function analyzeSentiment(text: string): Promise<SentimentResult> {
  const cacheKey = MLCache.hashKey(`sentiment:${text}`);
  const start = Date.now();

  // Check cache first
  const cached = cache.get<Omit<SentimentResult, 'cached' | 'latencyMs'>>(cacheKey);
  if (cached) {
    logger.debug('Sentiment cache hit');
    return { ...cached, cached: true, latencyMs: Date.now() - start };
  }

  try {
    const response = await axios.post(
      `${SERVICE_URL}/analyze`,
      { text },
      { timeout: 10000 }
    );

    const result: SentimentResult = {
      label: response.data.label,
      score: response.data.score,
      confidence: response.data.confidence,
      text,
      cached: false,
      latencyMs: Date.now() - start,
    };

    cache.set(cacheKey, { label: result.label, score: result.score, confidence: result.confidence, text }, 'sentiment', TTL);
    logger.debug('Sentiment analyzed', { label: result.label, score: result.score });
    return result;
  } catch (err) {
    logger.error('Sentiment service error', { error: String(err) });
    // Re-throw so callers know sentiment data is unavailable — do not silently return neutral
    throw new Error(`Sentiment service unavailable: ${String(err)}`);
  }
}

/**
 * Analyze multiple texts in batch
 */
export async function analyzeBatch(texts: string[]): Promise<SentimentResult[]> {
  return Promise.all(texts.map(t => analyzeSentiment(t)));
}

/**
 * Compute aggregate sentiment score from multiple results
 * Returns weighted average: positive=1, neutral=0, negative=-1
 */
export function aggregateSentiment(results: SentimentResult[]): {
  aggregate: number; // -1 to 1
  dominant: 'positive' | 'negative' | 'neutral';
  avgConfidence: number;
} {
  if (results.length === 0) return { aggregate: 0, dominant: 'neutral', avgConfidence: 0 };

  const weights = { positive: 1, neutral: 0, negative: -1 };
  let weightedSum = 0;
  let totalConfidence = 0;

  for (const r of results) {
    weightedSum += weights[r.label] * r.score * r.confidence;
    totalConfidence += r.confidence;
  }

  const aggregate = totalConfidence > 0 ? weightedSum / results.length : 0;
  const dominant =
    aggregate > 0.1 ? 'positive' : aggregate < -0.1 ? 'negative' : 'neutral';

  return {
    aggregate,
    dominant,
    avgConfidence: totalConfidence / results.length,
  };
}
