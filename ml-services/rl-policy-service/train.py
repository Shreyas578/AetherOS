"""
AetherOS RL Trading — Multi-Token Training Script
Trains PPO on REAL historical price data from CoinGecko + Binance
for ETH, BTC, SOL, BNB, MATIC, AVAX, PHRS (simulated) + synthetic fallback

Data sources (all free, no API key needed):
  - CoinGecko: https://api.coingecko.com/api/v3/coins/{id}/market_chart
  - Binance:   https://api.binance.com/api/v3/klines

Run: python train.py
Output: model/ppo_trading.zip
"""
import os
import time
import logging
import numpy as np
import requests
import gymnasium as gym
from gymnasium import spaces
from stable_baselines3 import PPO
from stable_baselines3.common.env_util import make_vec_env
from stable_baselines3.common.callbacks import CheckpointCallback

# Prevent torch threading deadlocks on Windows CPU
os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('MKL_NUM_THREADS', '1')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("rl-train")

# ─── Historical Data Fetching ────────────────────────────────────────────────

COINGECKO_IDS = {
    "ETH":   "ethereum",
    "BTC":   "bitcoin",
    "SOL":   "solana",
    "BNB":   "binancecoin",
    "MATIC": "polygon-ecosystem-token",  # rebranded from matic-network to POL
    "AVAX":  "avalanche-2",
}

BINANCE_SYMBOLS = {
    "ETH":   "ETHUSDT",
    "BTC":   "BTCUSDT",
    "SOL":   "SOLUSDT",
    "BNB":   "BNBUSDT",
    "MATIC": "MATICUSDT",
    "AVAX":  "AVAXUSDT",
}


def fetch_coingecko(token: str, days: int = 365) -> list[float]:
    """Fetch hourly close prices from CoinGecko (free tier, no key needed)."""
    cg_id = COINGECKO_IDS.get(token)
    if not cg_id:
        return []
    url = f"https://api.coingecko.com/api/v3/coins/{cg_id}/market_chart"
    params = {"vs_currency": "usd", "days": days, "interval": "hourly"}
    try:
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        prices = [p[1] for p in resp.json().get("prices", [])]
        logger.info(f"CoinGecko {token}: {len(prices)} hourly candles")
        return prices
    except Exception as e:
        logger.warning(f"CoinGecko failed for {token}: {e}")
        return []


def fetch_binance(token: str, limit: int = 1000) -> list[float]:
    """Fetch hourly close prices from Binance (free, no key needed)."""
    symbol = BINANCE_SYMBOLS.get(token)
    if not symbol:
        return []
    url = "https://api.binance.com/api/v3/klines"
    params = {"symbol": symbol, "interval": "1h", "limit": limit}
    try:
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        prices = [float(k[4]) for k in resp.json()]  # index 4 = close price
        logger.info(f"Binance {token}: {len(prices)} hourly candles")
        return prices
    except Exception as e:
        logger.warning(f"Binance failed for {token}: {e}")
        return []


def generate_synthetic(n: int = 2000, start_price: float = 2000.0) -> list[float]:
    """Generate realistic GBM synthetic prices as fallback."""
    prices = [start_price]
    for _ in range(n - 1):
        prices.append(prices[-1] * np.random.lognormal(0.0001, 0.025))
    return prices


def fetch_all_prices() -> dict[str, list[float]]:
    """Fetch real data for all tokens. Fall back to synthetic if both fail."""
    all_prices = {}
    tokens = list(COINGECKO_IDS.keys())

    for token in tokens:
        logger.info(f"Fetching {token}...")
        prices = fetch_coingecko(token, days=365)
        time.sleep(1.5)  # respect CoinGecko rate limit (free: ~10 req/min)

        if len(prices) < 100:
            logger.info(f"CoinGecko insufficient, trying Binance for {token}")
            prices = fetch_binance(token, limit=1000)

        if len(prices) < 50:
            logger.warning(f"All real sources failed for {token}, using synthetic data")
            prices = generate_synthetic(2000)

        all_prices[token] = prices
        logger.info(f"{token}: {len(prices)} price points ready")

    # PHRS/PROS: Pharos mainnet token — real data available (listed ~30 days)
    # CoinGecko ID: pharos-network, symbol: PROS, current price ~$0.56
    logger.info("PHRS/PROS: fetching real data from CoinGecko (30d available)...")
    pros_prices = []
    for days in [30, 7]:  # try 30d first, fallback to 7d
        try:
            r = requests.get(
                'https://api.coingecko.com/api/v3/coins/pharos-network/market_chart',
                params={'vs_currency': 'usd', 'days': days},
                timeout=20
            )
            r.raise_for_status()
            pros_prices = [p[1] for p in r.json().get('prices', []) if p[1] > 0]
            if len(pros_prices) >= 50:
                logger.info(f"PHRS/PROS: {len(pros_prices)} real candles from CoinGecko ({days}d)")
                break
        except Exception as e:
            logger.warning(f"CoinGecko PROS {days}d failed: {e}")
        time.sleep(1.2)

    if len(pros_prices) < 50:
        logger.warning("PHRS: insufficient real data, using synthetic with realistic PROS price range")
        pros_prices = generate_synthetic(2000, start_price=0.5)  # realistic PROS price

    all_prices["PHRS"] = pros_prices

    return all_prices


# ─── Trading Environment ─────────────────────────────────────────────────────

class MultiTokenTradingEnv(gym.Env):
    """
    Multi-token trading environment trained on REAL historical price data.
    Each episode samples a random token + random starting point in its history.

    Observation: [price_norm, sentiment_proxy, forecast_proxy, portfolio, volatility]
    Actions: 0=HOLD, 1=BUY, 2=SELL
    """
    metadata = {"render_modes": []}

    def __init__(self, all_prices: dict[str, list[float]], episode_length: int = 200):
        super().__init__()
        self.all_prices = all_prices
        self.tokens = list(all_prices.keys())
        self.episode_length = episode_length

        self.observation_space = spaces.Box(
            low=np.array([-10, -1, -10, 0, 0], dtype=np.float32),
            high=np.array([10,  1,  10, 10, 1], dtype=np.float32),
        )
        self.action_space = spaces.Discrete(3)

        self.prices: list[float] = []
        self.idx: int = 0
        self.price_norm_factor: float = 1.0
        self.reset()

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        # Pick a random token and random starting position
        token = self.tokens[np.random.randint(len(self.tokens))]
        price_series = self.all_prices[token]
        max_start = max(0, len(price_series) - self.episode_length - 30)
        start = np.random.randint(0, max_start + 1) if max_start > 0 else 0

        self.prices = price_series[start:]
        self.idx = 0
        self.step_count = 0
        self.portfolio = 1.0
        self.position = 0.0
        self.entry_price = 0.0
        self.peak_portfolio = 1.0
        self.trades = 0
        self.wins = 0

        # Normalize price relative to episode start
        self.price_norm_factor = max(self.prices[0], 1e-8)
        return self._obs(), {}

    def _current_price(self) -> float:
        if self.idx < len(self.prices):
            return float(self.prices[self.idx])
        return float(self.prices[-1])

    def _obs(self) -> np.ndarray:
        price = self._current_price()

        # Compute rolling 12-period returns as sentiment proxy (momentum)
        window = self.prices[max(0, self.idx - 12): self.idx + 1]
        if len(window) >= 2:
            momentum = (window[-1] - window[0]) / max(window[0], 1e-8)
            sentiment_proxy = float(np.clip(momentum * 10, -1, 1))
        else:
            sentiment_proxy = 0.0

        # Forecast proxy: linear extrapolation from last 6 candles
        look_back = self.prices[max(0, self.idx - 5): self.idx + 1]
        if len(look_back) >= 2:
            slope = (look_back[-1] - look_back[0]) / max(look_back[0], 1e-8)
            forecast_price = price * (1 + slope)
        else:
            forecast_price = price

        # Volatility: rolling 12-period std of returns
        ret_window = self.prices[max(0, self.idx - 12): self.idx + 1]
        if len(ret_window) >= 2:
            returns = [(ret_window[i+1] - ret_window[i]) / max(ret_window[i], 1e-8) for i in range(len(ret_window)-1)]
            volatility = float(min(1.0, np.std(returns) / 0.05))
        else:
            volatility = 0.3

        price_norm = float(np.clip(price / self.price_norm_factor, 0, 10))
        forecast_norm = float(np.clip(forecast_price / self.price_norm_factor, 0, 10))

        return np.array([price_norm, sentiment_proxy, forecast_norm, self.portfolio, volatility], dtype=np.float32)

    def step(self, action):
        self.step_count += 1
        self.idx = min(self.idx + 1, len(self.prices) - 1)

        price = self._current_price()
        prev_portfolio = self.portfolio
        reward = 0.0

        if action == 1:  # BUY
            if self.position == 0:
                self.position = 0.5
                self.entry_price = price
                reward = -0.001  # transaction cost

        elif action == 2:  # SELL
            if self.position > 0:
                pnl = (price - self.entry_price) / max(self.entry_price, 1e-8)
                reward = pnl * 10.0
                self.portfolio += pnl * self.position
                self.trades += 1
                if pnl > 0:
                    self.wins += 1
                self.position = 0.0
                self.entry_price = 0.0

        else:  # HOLD
            if self.position > 0:
                unrealized = (price - self.entry_price) / max(self.entry_price, 1e-8)
                reward = unrealized * 0.01

        # Drawdown penalty
        self.peak_portfolio = max(self.peak_portfolio, self.portfolio)
        drawdown = (self.peak_portfolio - self.portfolio) / max(self.peak_portfolio, 1e-8)
        if drawdown > 0.1:
            reward -= drawdown * 0.5

        terminated = self.portfolio <= 0.5
        truncated = self.step_count >= self.episode_length

        return self._obs(), float(reward), terminated, truncated, {}

    def render(self):
        pass


# ─── Training ─────────────────────────────────────────────────────────────────

def train():
    os.makedirs("model", exist_ok=True)
    os.makedirs("checkpoints", exist_ok=True)

    logger.info("Fetching historical price data...")
    all_prices = fetch_all_prices()

    total_candles = sum(len(v) for v in all_prices.values())
    logger.info(f"Total training data: {total_candles:,} price candles across {len(all_prices)} tokens")
    for token, prices in all_prices.items():
        logger.info(f"  {token}: {len(prices)} candles | price range ${min(prices):.4f} – ${max(prices):.4f}")

    logger.info("Creating vectorized training environments (8 parallel)...")
    env = make_vec_env(lambda: MultiTokenTradingEnv(all_prices), n_envs=8)

    logger.info("Initializing PPO agent...")
    model = PPO(
        "MlpPolicy",
        env,
        verbose=1,
        learning_rate=2e-4,
        n_steps=2048,
        batch_size=256,
        n_epochs=10,
        gamma=0.99,
        gae_lambda=0.95,
        clip_range=0.2,
        ent_coef=0.03,
        # Use default net_arch — deeper networks cause torch threading deadlocks on Windows CPU
    )

    checkpoint_cb = CheckpointCallback(
        save_freq=50000,
        save_path="./checkpoints/",
        name_prefix="ppo_multitok",
    )

    total_steps = 500_000
    logger.info(f"Starting training — {total_steps:,} steps on real multi-token data...")
    model.learn(
        total_timesteps=total_steps,
        callback=checkpoint_cb,
        progress_bar=True,
    )

    model.save("model/ppo_trading")
    logger.info("Model saved to model/ppo_trading.zip")
    logger.info("Training complete!")


if __name__ == "__main__":
    train()
