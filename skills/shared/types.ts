// Shared types for AetherOS skill system

export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  inputs: Record<string, { type: string; description: string; required: boolean }>;
  outputs: Record<string, { type: string; description: string }>;
  dependencies: string[];
  estimatedGasCost: string; // "0" for read-only, "~21000" for tx, etc.
  tags: string[];
}

export interface PriceResult {
  token: string;
  priceUsd: number;
  pricePhrs: number;
  source: 'coingecko' | 'onchain' | 'cached';
  timestamp: number;
  change24h?: number;
}

export interface SentimentResult {
  label: 'positive' | 'negative' | 'neutral';
  score: number;       // 0-1
  confidence: number;  // 0-1
  text: string;
  cached: boolean;
  latencyMs: number;
}

export interface RiskScore {
  score: number;          // 0-100 (lower = safer)
  grade: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  breakdown: {
    slippageRisk: number;
    liquidityDepth: number;
    positionSizePct: number;
    volatilityScore: number;
    sentimentRisk: number;
    reputationRisk: number;
  };
  approved: boolean;       // score < MAX_RISK_SCORE
  reason: string;
}

export interface WalletTxResult {
  hash: string;
  receipt: {
    blockNumber: number;
    gasUsed: bigint;
    status: number | null;
  };
  gasUsed: bigint;
  retries: number;
}

export interface ForecastResult {
  token: string;
  forecastedPrice: number;
  confidence: number;        // 0-1
  direction: 'up' | 'down' | 'sideways';
  horizonHours: number;
  model: 'prophet' | 'lstm' | 'ensemble';
  cached: boolean;
  latencyMs: number;
}

export interface RLPolicyResult {
  action: 0 | 1 | 2;           // 0=hold, 1=buy, 2=sell
  actionLabel: 'HOLD' | 'BUY' | 'SELL';
  confidence: number;           // 0-1
  cached: boolean;
  latencyMs: number;
}

export interface ReputationResult {
  wallet: string;
  score: number;              // 0-100
  tier: 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH' | 'TRUSTED';
  txCount: number;
  successRate: number;
  agedays: number;
  onChainTokenId?: number;
}

export interface GovernanceProposal {
  id: string;
  onChainId: string;
  title: string;
  text: string;
  summary?: string;
  status: 'active' | 'closed' | 'executed';
  deadline?: number;
}

export interface LLMResponse<T = unknown> {
  data: T;
  rawText: string;
  model: string;
  latencyMs: number;
  retried: boolean;
}

export interface SocialPostResult {
  postId: string;
  txHash: string;
  ipfsUri: string;
  contentHash: string;
}
