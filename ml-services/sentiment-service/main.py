import os
import re
import time
import logging

# Must be set before ANY torch/numpy import — controls C-level thread pools
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["NUMEXPR_NUM_THREADS"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ.setdefault("HF_HOME", "D:\\.cache\\huggingface")

# Now safe to import torch-dependent libs
import torch
torch.set_num_threads(1)
torch.set_num_interop_threads(1)

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from transformers import pipeline, AutoTokenizer, AutoModelForSequenceClassification

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sentiment-service")

app = FastAPI(title="AetherOS Sentiment Service", version="1.0.0")

MODEL_NAME = "ProsusAI/finbert"
classifier = None
_model_mode = "unloaded"

# ─── Lexicon fallback (used if FinBERT fails) ────────────────────────────────
_POSITIVE = {"bullish","gain","gains","up","moon","rally","surge","profit","buy",
             "strong","growth","positive","breakout","pump","high","beat","outperform"}
_NEGATIVE = {"bearish","crash","down","dump","loss","losses","sell","weak","drop",
             "fall","negative","decline","risk","fear","panic","miss","underperform"}

def lexicon_sentiment(text: str) -> tuple[str, float, float]:
    words = set(re.findall(r"[a-z]+", text.lower()))
    pos = len(words & _POSITIVE)
    neg = len(words & _NEGATIVE)
    total = pos + neg
    if total == 0:
        return "neutral", 0.5, 0.4
    if pos > neg:
        return "positive", 0.5 + min(0.45, pos / (total + 2)), 0.55
    if neg > pos:
        return "negative", 0.5 + min(0.45, neg / (total + 2)), 0.55
    return "neutral", 0.5, 0.5


# ─── FinBERT loader ──────────────────────────────────────────────────────────
def load_finbert():
    global classifier, _model_mode
    if _model_mode in ("finbert", "lexicon-fallback"):
        return
    try:
        logger.info("Loading FinBERT (ProsusAI/finbert)...")
        tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
        model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME)
        classifier = pipeline(
            "text-classification",
            model=model,
            tokenizer=tokenizer,
            device=-1,       # CPU
            top_k=None,      # return all label scores
        )
        _model_mode = "finbert"
        logger.info("FinBERT loaded successfully on CPU")
    except Exception as e:
        classifier = None
        _model_mode = "lexicon-fallback"
        logger.warning(f"FinBERT failed to load, using lexicon fallback: {e}")


class AnalyzeRequest(BaseModel):
    text: str

class AnalyzeResponse(BaseModel):
    label: str
    score: float
    confidence: float
    latency_ms: int
    model: str


@app.on_event("startup")
def startup():
    load_finbert()


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": _model_mode,
        "finbert_loaded": _model_mode == "finbert",
    }


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    start = time.time()

    # Use FinBERT if loaded
    if classifier is not None and _model_mode == "finbert":
        try:
            raw = classifier(req.text[:2000])
            # Handle both flat and nested output across transformers versions
            if isinstance(raw, list) and len(raw) > 0:
                results = raw[0] if isinstance(raw[0], list) else raw
            else:
                raise ValueError(f"Unexpected output: {raw}")

            sorted_r = sorted(results, key=lambda x: x["score"], reverse=True)
            top = sorted_r[0]
            label = top["label"].lower()
            score = float(top["score"])
            conf  = score - float(sorted_r[1]["score"]) if len(sorted_r) > 1 else score
            ms    = int((time.time() - start) * 1000)
            logger.info(f"[finbert] label={label} score={score:.3f} conf={conf:.3f} latency={ms}ms")
            return AnalyzeResponse(label=label, score=score,
                                   confidence=min(1.0, conf), latency_ms=ms, model="finbert")
        except Exception as e:
            logger.error(f"FinBERT inference failed, falling back to lexicon: {e}")

    # Lexicon fallback
    label, score, conf = lexicon_sentiment(req.text)
    ms = int((time.time() - start) * 1000)
    logger.info(f"[lexicon] label={label} score={score:.3f} latency={ms}ms")
    return AnalyzeResponse(label=label, score=score, confidence=conf, latency_ms=ms, model="lexicon-fallback")


@app.post("/analyze/batch")
def analyze_batch(texts: list[str]):
    return [analyze(AnalyzeRequest(text=t)) for t in texts]


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9001)
