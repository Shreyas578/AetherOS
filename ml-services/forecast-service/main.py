import os
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

import time
import logging
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("forecast-service")

app = FastAPI(title="AetherOS Forecast Service", version="1.0.0")

# Lazy-load Prophet — broken pandas/prophet installs should not crash the service
_prophet_available = False
_prophet_tried = False
_pd = None
_Prophet = None


def _load_prophet():
    global _prophet_available, _prophet_tried, _pd, _Prophet
    if _prophet_tried:
        return
    _prophet_tried = True
    try:
        import pandas as pd
        if not hasattr(pd, "Series"):
            raise ImportError("pandas install is broken (missing Series) — reinstall in a venv")
        from prophet import Prophet
        _pd = pd
        _Prophet = Prophet
        _prophet_available = True
        logger.info("Prophet loaded successfully")
    except Exception as e:
        _prophet_available = False
        logger.warning(f"Prophet unavailable, using numpy fallback: {e}")


class ForecastRequest(BaseModel):
    token: str
    prices: list[float]
    timestamps: list[int]
    horizon_hours: int = 24


class ForecastResponse(BaseModel):
    token: str
    forecasted_price: float
    confidence: float
    direction: str
    horizon_hours: int
    model: str
    latency_ms: int


def numpy_forecast(prices: list[float], horizon_hours: int) -> tuple[float, float]:
    """Linear regression fallback when Prophet is unavailable."""
    y = np.array(prices, dtype=np.float64)
    x = np.arange(len(y), dtype=np.float64)
    if len(y) < 2:
        return float(y[-1]), 0.3

    slope, intercept = np.polyfit(x, y, 1)
    pred = float(intercept + slope * (len(y) - 1 + horizon_hours))

    residuals = y - (slope * x + intercept)
    std = float(np.std(residuals)) if len(residuals) > 1 else abs(y[-1]) * 0.05
    confidence = max(0.2, min(0.85, 1.0 - std / max(abs(pred), 1e-8)))
    return pred, confidence


def prophet_forecast(prices: list, timestamps: list, horizon_hours: int) -> tuple[float, float]:
    _load_prophet()
    if not _prophet_available or _pd is None or _Prophet is None:
        return numpy_forecast(prices, horizon_hours)

    df = _pd.DataFrame({
        "ds": _pd.to_datetime(timestamps, unit="ms"),
        "y": prices,
    })
    if not df["ds"].is_monotonic_increasing:
        df = df.sort_values("ds").reset_index(drop=True)

    m = _Prophet(
        daily_seasonality=True,
        weekly_seasonality=len(prices) >= 168,
        changepoint_prior_scale=0.1,
        interval_width=0.8,
    )
    m.fit(df)

    future = m.make_future_dataframe(periods=horizon_hours, freq="h")
    forecast = m.predict(future)

    last_row = forecast.iloc[-1]
    pred = float(last_row["yhat"])
    lower = float(last_row["yhat_lower"])
    upper = float(last_row["yhat_upper"])

    interval_pct = abs(upper - lower) / max(abs(pred), 1e-8)
    confidence = max(0.0, min(1.0, 1.0 - interval_pct))
    return pred, confidence


@app.on_event("startup")
def startup():
    _load_prophet()


@app.get("/health")
def health():
    _load_prophet()
    return {
        "status": "ok",
        "service": "forecast",
        "model": "prophet" if _prophet_available else "numpy-fallback",
    }


@app.post("/forecast", response_model=ForecastResponse)
def forecast(req: ForecastRequest):
    if len(req.prices) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 price points")
    if len(req.prices) != len(req.timestamps):
        raise HTTPException(status_code=400, detail="prices and timestamps must have equal length")

    start = time.time()
    last_price = req.prices[-1]

    try:
        pred, confidence = prophet_forecast(req.prices, req.timestamps, req.horizon_hours)
        model = "prophet" if _prophet_available else "numpy-fallback"
    except Exception as e:
        logger.error(f"Forecast failed: {e}")
        pred, confidence = numpy_forecast(req.prices, req.horizon_hours)
        model = "numpy-fallback"

    change_pct = (pred - last_price) / max(abs(last_price), 1e-8) * 100
    direction = "up" if change_pct > 1.5 else "down" if change_pct < -1.5 else "sideways"

    latency_ms = int((time.time() - start) * 1000)
    logger.info(f"Forecast {req.token}: {pred:.4f} ({direction}), conf={confidence:.3f}, model={model}")

    return ForecastResponse(
        token=req.token,
        forecasted_price=round(pred, 6),
        confidence=round(confidence, 4),
        direction=direction,
        horizon_hours=req.horizon_hours,
        model=model,
        latency_ms=latency_ms,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9002)
