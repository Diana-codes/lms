"""Kora Lend ML service.

Scores applications and flags early-warning signs with transparent rules
(app/scoring.py). Swap in a trained model once there are enough of our own
loan outcomes; keep the same request and response shapes, and keep returning
reasons and a model version with every answer.
"""

from fastapi import FastAPI

from app.scoring import MODEL_VERSION, ScoreRequest, ScoreResponse, WarningRequest, WarningResponse, early_warning, score

app = FastAPI(title="Kora Lend ML", version="1.0.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model_version": MODEL_VERSION}


@app.post("/v1/score")
def score_endpoint(req: ScoreRequest) -> ScoreResponse:
    return score(req)


@app.post("/v1/early-warning")
def warning_endpoint(req: WarningRequest) -> WarningResponse:
    return early_warning(req)
