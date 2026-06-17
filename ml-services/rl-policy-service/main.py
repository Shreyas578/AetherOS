import gymnasium as gym
from gymnasium import spaces
import numpy as np
import os
import logging
import time

# Prevent torch threading deadlocks on Windows CPU
os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('MKL_NUM_THREADS', '1')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("rl-policy-service")

app = FastAPI(title="AetherOS RL Policy Service", version="1.0.0")

MODEL_PATH = os.environ.get("RL_MODEL_PATH", "./model/ppo_trading.zip")

# Lazy-load SB3 to allow service to start without trained model
_model = None


def load_model():
    global _model
    if _model is not None:
        return _model
    try:
        from stable_baselines3 import PPO
        if os.path.exists(MODEL_PATH):
            _model = PPO.load(MODEL_PATH)
            logger.info(f"PPO model loaded from {MODEL_PATH}")
        else:
            raise FileNotFoundError(f"RL model not found at {MODEL_PATH}. Run train.py first.")
    except ImportError:
        raise RuntimeError("stable-baselines3 not installed. Run: pip install stable-baselines3")
    return _model


class PolicyRequest(BaseModel):
    price: float
    sentiment: float       # -1 to 1
    forecast: float        # forecasted price
    portfolio: float       # portfolio value in USD
    volatility: float      # 0-1 normalized volatility


class PolicyResponse(BaseModel):
    action: int            # 0=hold, 1=buy, 2=sell
    action_label: str
    confidence: float
    latency_ms: int


ACTION_LABELS = {0: "HOLD", 1: "BUY", 2: "SELL"}


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": _model is not None}


@app.post("/predict", response_model=PolicyResponse)
def predict(req: PolicyRequest):
    start = time.time()
    try:
        model = load_model()
    except (FileNotFoundError, RuntimeError) as e:
        raise HTTPException(status_code=503, detail=str(e))

    obs = np.array([req.price, req.sentiment, req.forecast, req.portfolio, req.volatility], dtype=np.float32)
    # Normalize obs to reasonable range
    obs = np.clip(obs / np.array([100000, 1, 100000, 1000000, 1], dtype=np.float32), -10, 10)

    action, _states = model.predict(obs, deterministic=True)
    action = int(action)

    # Estimate confidence from action probabilities
    confidence = 0.6
    try:
        import torch
        obs_tensor = model.policy.obs_to_tensor(obs.reshape(1, -1))[0]
        with torch.no_grad():
            dist = model.policy.get_distribution(obs_tensor)
            probs = dist.distribution.probs.cpu().numpy()[0]
        confidence = float(probs[action])
    except Exception:
        pass  # keep default confidence if torch extraction fails

    latency_ms = int((time.time() - start) * 1000)
    logger.info(f"Policy: action={ACTION_LABELS[action]}, confidence={confidence:.3f}")

    return PolicyResponse(
        action=action,
        action_label=ACTION_LABELS[action],
        confidence=round(confidence, 4),
        latency_ms=latency_ms,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9003)
