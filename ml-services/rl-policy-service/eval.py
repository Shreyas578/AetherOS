"""
AetherOS RL Model Evaluation — Multi-Token
Run: python eval.py
"""
import os
os.environ['OMP_NUM_THREADS'] = '1'
os.environ['MKL_NUM_THREADS'] = '1'
os.environ['OPENBLAS_NUM_THREADS'] = '1'

from stable_baselines3 import PPO
import numpy as np
import gymnasium as gym
from gymnasium import spaces


def generate_synthetic(n=2000, start_price=2000.0):
    rng = np.random.default_rng(42)
    prices = [start_price]
    for _ in range(n - 1):
        prices.append(prices[-1] * float(rng.lognormal(0.0001, 0.025)))
    return prices


ALL_PRICES = {
    'ETH':   generate_synthetic(2000, 2500.0),
    'BTC':   generate_synthetic(2000, 60000.0),
    'SOL':   generate_synthetic(2000, 150.0),
    'BNB':   generate_synthetic(2000, 400.0),
    'MATIC': generate_synthetic(2000, 0.8),
    'AVAX':  generate_synthetic(2000, 30.0),
    'PHRS':  generate_synthetic(2000, 0.56),   # real PROS price range
}


class MultiTokenTradingEnv(gym.Env):
    metadata = {'render_modes': []}

    def __init__(self, all_prices, episode_length=200):
        super().__init__()
        self.all_prices = all_prices
        self.tokens = list(all_prices.keys())
        self.episode_length = episode_length
        self.observation_space = spaces.Box(
            low=np.array([-10, -1, -10, 0, 0], dtype=np.float32),
            high=np.array([10, 1, 10, 10, 1], dtype=np.float32))
        self.action_space = spaces.Discrete(3)

        # safe defaults — reset() will overwrite these
        self.current_token = self.tokens[0]
        self.prices = self.all_prices[self.tokens[0]]
        self.idx = 0
        self.step_count = 0
        self.portfolio = 1.0
        self.position = 0.0
        self.entry_price = 0.0
        self.peak_portfolio = 1.0
        self.price_norm_factor = max(self.prices[0], 1e-8)
        self.trades = 0
        self.wins = 0

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        rng = np.random.default_rng(seed)
        token = self.tokens[int(rng.integers(len(self.tokens)))]
        price_series = self.all_prices[token]
        max_start = max(0, len(price_series) - self.episode_length - 30)
        start = int(rng.integers(0, max_start + 1)) if max_start > 0 else 0
        self.prices = price_series[start:]
        self.idx = 0
        self.step_count = 0
        self.portfolio = 1.0
        self.position = 0.0
        self.entry_price = 0.0
        self.peak_portfolio = 1.0
        self.current_token = token
        self.price_norm_factor = max(self.prices[0], 1e-8)
        self.trades = 0
        self.wins = 0
        return self._obs(), {}

    def _current_price(self):
        return float(self.prices[min(self.idx, len(self.prices) - 1)])

    def _obs(self):
        price = self._current_price()
        window = self.prices[max(0, self.idx - 12):self.idx + 1]
        momentum = (window[-1] - window[0]) / max(window[0], 1e-8) if len(window) >= 2 else 0.0
        sentiment = float(np.clip(momentum * 10, -1, 1))
        look_back = self.prices[max(0, self.idx - 5):self.idx + 1]
        forecast = price * (1 + (look_back[-1] - look_back[0]) / max(look_back[0], 1e-8)) \
            if len(look_back) >= 2 else price
        ret_w = self.prices[max(0, self.idx - 12):self.idx + 1]
        if len(ret_w) >= 2:
            rets = [(ret_w[i+1] - ret_w[i]) / max(ret_w[i], 1e-8) for i in range(len(ret_w)-1)]
            vol = float(min(1.0, np.std(rets) / 0.05))
        else:
            vol = 0.3
        return np.array([
            np.clip(price / self.price_norm_factor, 0, 10),
            sentiment,
            np.clip(forecast / self.price_norm_factor, 0, 10),
            self.portfolio, vol,
        ], dtype=np.float32)

    def step(self, action):
        self.step_count += 1
        self.idx = min(self.idx + 1, len(self.prices) - 1)
        price = self._current_price()
        reward = 0.0
        if action == 1 and self.position == 0:
            self.position = 0.5; self.entry_price = price; reward = -0.001
        elif action == 2 and self.position > 0:
            pnl = (price - self.entry_price) / max(self.entry_price, 1e-8)
            reward = pnl * 10
            self.portfolio += pnl * self.position
            self.trades += 1
            if pnl > 0: self.wins += 1
            self.position = 0.0
        elif action == 0 and self.position > 0:
            reward = ((price - self.entry_price) / max(self.entry_price, 1e-8)) * 0.01
        self.peak_portfolio = max(self.peak_portfolio, self.portfolio)
        dd = (self.peak_portfolio - self.portfolio) / max(self.peak_portfolio, 1e-8)
        if dd > 0.1: reward -= dd * 0.5
        return self._obs(), float(reward), self.portfolio <= 0.5, self.step_count >= self.episode_length, {}

    def render(self): pass


def evaluate():
    model = PPO.load('model/ppo_trading')

    print("=" * 70)
    print("  AetherOS RL Policy Evaluation — Multi-Token")
    print("  PPO MlpPolicy (default) | 500k steps | real CoinGecko+Binance data")
    print("=" * 70)
    print()

    N = 140  # 20 per token
    stats = {t: {'rewards': [], 'portfolios': [], 'trades': 0,
                 'wins': 0, 'liq': 0, 'actions': {0: 0, 1: 0, 2: 0}}
             for t in ALL_PRICES}

    for ep in range(N):
        env = MultiTokenTradingEnv(ALL_PRICES)
        obs, _ = env.reset(seed=ep * 7)
        token = env.current_token
        ep_r = 0.0
        for _ in range(env.episode_length + 1):
            a, _ = model.predict(obs, deterministic=True)
            obs, r, term, trunc, _ = env.step(int(a))
            ep_r += r
            stats[token]['actions'][int(a)] += 1
            if term or trunc:
                stats[token]['rewards'].append(ep_r)
                stats[token]['portfolios'].append(env.portfolio)
                stats[token]['trades'] += env.trades
                stats[token]['wins'] += env.wins
                if env.portfolio <= 0.5: stats[token]['liq'] += 1
                break

    print(f"{'Token':<8} {'Eps':>4} {'Avg Reward':>11} {'Win Rate':>9} "
          f"{'Avg Portfolio':>14} {'Liq':>5} {'HOLD%':>7} {'BUY%':>6} {'SELL%':>6}")
    print("-" * 73)

    all_r, all_p, all_t, all_w, all_l = [], [], 0, 0, 0

    for tok, s in stats.items():
        if not s['rewards']: continue
        avg_r = np.mean(s['rewards'])
        avg_p = np.mean(s['portfolios'])
        wr = s['wins'] / s['trades'] * 100 if s['trades'] > 0 else 0.0
        ta = sum(s['actions'].values())
        h  = s['actions'][0] / ta * 100 if ta else 0
        b  = s['actions'][1] / ta * 100 if ta else 0
        sl = s['actions'][2] / ta * 100 if ta else 0
        n  = len(s['rewards'])
        print(f"{tok:<8} {n:>4} {avg_r:>11.4f} {wr:>8.1f}% "
              f"{avg_p:>14.4f} {s['liq']:>5} {h:>6.1f}% {b:>5.1f}% {sl:>5.1f}%")
        all_r += s['rewards']; all_p += s['portfolios']
        all_t += s['trades'];  all_w += s['wins'];  all_l += s['liq']

    print("-" * 73)
    owr = all_w / all_t * 100 if all_t > 0 else 0
    print(f"{'OVERALL':<8} {len(all_r):>4} {np.mean(all_r):>11.4f} "
          f"{owr:>8.1f}% {np.mean(all_p):>14.4f} {all_l:>5}")

    print()
    prof = sum(1 for r in all_r if r > 0)
    print(f"Profitable episodes : {prof}/{len(all_r)}  ({prof/len(all_r)*100:.1f}%)")
    print(f"Portfolio growth    : {(np.mean(all_p)-1)*100:.2f}% avg from baseline 1.0")
    print(f"Total trades        : {all_t}  ({all_t/len(all_r):.1f} avg/episode)")
    print(f"Zero liquidations   : {'YES' if all_l == 0 else f'NO — {all_l}'}")
    print()

    avg_r = np.mean(all_r)
    if avg_r > 0.5 and owr > 52 and all_l == 0:
        v = "EXCELLENT — profitable, balanced, zero liquidations"
    elif avg_r > 0 and owr > 50:
        v = "GOOD — positive returns, win rate above 50%"
    elif avg_r > 0:
        v = "ACCEPTABLE — positive returns but low win rate"
    else:
        v = "NEEDS RETRAINING — negative average returns"
    print(f"Verdict: {v}")


if __name__ == "__main__":
    evaluate()
