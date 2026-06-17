/**
 * AetherOS Backtesting Sandbox
 * Replays historical price data through the full trading pipeline
 * WITHOUT touching the chain.
 * Output: Sharpe ratio, win rate, max drawdown, full trade log
 *
 * Usage: ts-node scripts/backtest.ts [--csv ./data/prices.csv]
 */
import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { computeRiskScore } from '../skills/risk-scorer/index';
import { createLogger } from '../skills/shared/index';

const logger = createLogger('backtest');
const RL_URL = process.env.RL_POLICY_SERVICE_URL || 'http://localhost:8003';
const FORECAST_URL = process.env.FORECAST_SERVICE_URL || 'http://localhost:8002';

interface TradeRecord {
  timestamp: number;
  price: number;
  action: 'BUY' | 'SELL' | 'HOLD';
  riskScore: number;
  approved: boolean;
  pnlPct: number;
  portfolioValue: number;
}

function generateSyntheticPrices(count = 200): { prices: number[]; timestamps: number[] } {
  // Geometric Brownian Motion
  const prices: number[] = [3000];
  const timestamps: number[] = [Date.now() - count * 3600000];
  for (let i = 1; i < count; i++) {
    const drift = 0.0001;
    const vol = 0.02;
    const rand = (Math.random() - 0.5) * 2;
    prices.push(prices[i - 1] * Math.exp(drift + vol * rand));
    timestamps.push(timestamps[0] + i * 3600000);
  }
  return { prices, timestamps };
}

function loadPricesFromCSV(csvPath: string): { prices: number[]; timestamps: number[] } {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n').slice(1); // skip header
  const prices: number[] = [];
  const timestamps: number[] = [];
  for (const line of lines) {
    const [ts, price] = line.split(',');
    if (ts && price) {
      timestamps.push(parseInt(ts));
      prices.push(parseFloat(price));
    }
  }
  return { prices, timestamps };
}

async function runBacktest() {
  logger.info('Starting backtest...');
  const csvArg = process.argv.find(a => a.startsWith('--csv='))?.split('=')[1];
  const { prices, timestamps } = csvArg
    ? loadPricesFromCSV(csvArg)
    : generateSyntheticPrices(200);

  logger.info(`Loaded ${prices.length} price points`);

  const WINDOW = 24; // rolling window for forecast
  let portfolioValue = 10000; // $10k starting portfolio
  let position: { price: number; size: number } | null = null;
  const trades: TradeRecord[] = [];
  const portfolioHistory: number[] = [portfolioValue];

  for (let i = WINDOW; i < prices.length; i++) {
    const window = prices.slice(i - WINDOW, i);
    const windowTimestamps = timestamps.slice(i - WINDOW, i);
    const currentPrice = prices[i];
    const currentTime = timestamps[i];

    // Get forecast
    let forecastedPrice = currentPrice;
    let forecastConf = 0.5;
    let forecastDir = 'sideways';
    try {
      const resp = await axios.post(`${FORECAST_URL}/forecast`, {
        token: 'ETH', prices: window, timestamps: windowTimestamps, horizon_hours: 24,
      }, { timeout: 15000 });
      forecastedPrice = resp.data.forecasted_price;
      forecastConf = resp.data.confidence;
      forecastDir = resp.data.direction;
    } catch { /* use defaults */ }

    // Compute volatility
    const returns = window.slice(1).map((p, j) => (p - window[j]) / window[j]);
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / returns.length;
    const volatility = Math.min(1, Math.sqrt(variance) / 0.05);

    // Get RL action
    let action = 0;
    let actionLabel = 'HOLD';
    try {
      const resp = await axios.post(`${RL_URL}/predict`, {
        price: currentPrice,
        sentiment: 0, // neutral in backtest
        forecast: forecastedPrice,
        portfolio: portfolioValue,
        volatility,
      }, { timeout: 5000 });
      action = resp.data.action;
      actionLabel = resp.data.action_label;
    } catch { /* default to HOLD */ }

    // Risk check
    const tradeValue = portfolioValue * 0.02;
    const risk = computeRiskScore({
      currentPriceUsd: currentPrice,
      tradeValueUsd: tradeValue,
      portfolioValueUsd: portfolioValue,
      priceHistory: window,
      sentimentScore: 0,
      sentimentConfidence: 0.8,
      sourceReputationScore: 70,
    });

    let pnlPct = 0;
    let finalAction = actionLabel as 'BUY' | 'SELL' | 'HOLD';

    if (risk.approved) {
      if (actionLabel === 'BUY' && !position) {
        position = { price: currentPrice, size: tradeValue / currentPrice };
      } else if (actionLabel === 'SELL' && position) {
        pnlPct = (currentPrice - position.price) / position.price;
        portfolioValue += position.size * currentPrice - (tradeValue); // net PnL
        position = null;
      }
    } else {
      finalAction = 'HOLD'; // blocked by risk
    }

    portfolioHistory.push(portfolioValue);
    trades.push({
      timestamp: currentTime,
      price: currentPrice,
      action: finalAction,
      riskScore: risk.score,
      approved: risk.approved,
      pnlPct,
      portfolioValue,
    });
  }

  // ─── Metrics ───────────────────────────────────────────────────────────────
  const completedTrades = trades.filter(t => t.action === 'SELL');
  const wins = completedTrades.filter(t => t.pnlPct > 0);
  const losses = completedTrades.filter(t => t.pnlPct <= 0);
  const winRate = completedTrades.length > 0 ? wins.length / completedTrades.length : 0;

  // Sharpe ratio (annualized, using portfolio returns)
  const pfReturns = portfolioHistory.slice(1).map((v, i) => (v - portfolioHistory[i]) / portfolioHistory[i]);
  const pfMean = pfReturns.reduce((a, b) => a + b, 0) / pfReturns.length;
  const pfVar = pfReturns.reduce((a, r) => a + Math.pow(r - pfMean, 2), 0) / pfReturns.length;
  const pfStd = Math.sqrt(pfVar);
  const sharpe = pfStd > 0 ? (pfMean / pfStd) * Math.sqrt(8760) : 0; // annualized hourly

  // Max drawdown
  let peak = portfolioHistory[0];
  let maxDD = 0;
  for (const v of portfolioHistory) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  const report = {
    summary: {
      startingCapital: 10000,
      finalPortfolioValue: Math.round(portfolioValue * 100) / 100,
      totalReturn: `${(((portfolioValue - 10000) / 10000) * 100).toFixed(2)}%`,
      sharpeRatio: Math.round(sharpe * 1000) / 1000,
      winRate: `${(winRate * 100).toFixed(1)}%`,
      maxDrawdown: `${(maxDD * 100).toFixed(2)}%`,
      totalTrades: completedTrades.length,
      wins: wins.length,
      losses: losses.length,
      pricePoints: prices.length,
    },
    tradeLog: trades.filter(t => t.action !== 'HOLD').slice(0, 50), // first 50 trades
  };

  // ASCII table
  console.log('\n' + '='.repeat(60));
  console.log('  AetherOS Backtest Report');
  console.log('='.repeat(60));
  for (const [k, v] of Object.entries(report.summary)) {
    console.log(`  ${k.padEnd(25)} ${v}`);
  }
  console.log('='.repeat(60) + '\n');

  // Save JSON report
  const outPath = path.resolve('./backtest-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  logger.info(`Report saved to ${outPath}`);

  return report;
}

runBacktest().catch(err => {
  logger.error('Backtest failed', { error: String(err) });
  process.exit(1);
});
