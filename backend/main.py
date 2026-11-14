
from pathlib import Path
from collections import defaultdict, deque
import os
import threading
import time

import joblib
import pandas as pd

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


# --------------------------------------------------
# 1. PROJECT AND MODEL CONFIGURATION
# --------------------------------------------------

# backend/main.py -> SATCom_Project/
PROJECT_ROOT = Path(__file__).resolve().parent.parent

MODEL_PATH = PROJECT_ROOT / "results" / "rf_fso_random_forest.joblib"

# Load the existing trained model. Do not retrain it.
if not MODEL_PATH.exists():
    raise FileNotFoundError(
        f"Trained model not found at: {MODEL_PATH}"
    )

bundle = joblib.load(MODEL_PATH)

model = bundle["model"]
FEATURES = bundle["features"]


# --------------------------------------------------
# 2. FASTAPI APPLICATION
# --------------------------------------------------

is_production = os.getenv("ENVIRONMENT", "development").strip().lower() == "production"

app = FastAPI(
    title="SATCOM Adaptive Link API",
    description="RF-FSO link prediction using the existing trained model.",
    version="1.0.0",
    docs_url=None if is_production else "/docs",
    redoc_url=None if is_production else "/redoc",
    openapi_url=None if is_production else "/openapi.json",
)


# --------------------------------------------------
# 3. CORS CONFIGURATION
# --------------------------------------------------

# Local development URLs are always allowed. Add deployed frontend origins
# through ALLOWED_ORIGINS as a comma-separated list.
allowed_origins = list(dict.fromkeys([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://adaptive-satcom.vercel.app",
    *(
        origin.strip().rstrip("/")
        for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
        if origin.strip()
    ),
]))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------
# 4. IN-MEMORY RATE LIMITING
# --------------------------------------------------

_RATE_LIMIT_WINDOW_SECONDS = 60
_rate_limit_requests = defaultdict(deque)
_rate_limit_lock = threading.Lock()


def _check_rate_limit(request: Request, limit: int) -> None:

    client_ip = request.client.host if request.client else "unknown"
    now = time.monotonic()

    with _rate_limit_lock:
        timestamps = _rate_limit_requests[client_ip]
        cutoff = now - _RATE_LIMIT_WINDOW_SECONDS
        while timestamps and timestamps[0] <= cutoff:
            timestamps.popleft()

        if len(timestamps) >= limit:
            retry_after = max(
                1,
                int(timestamps[0] + _RATE_LIMIT_WINDOW_SECONDS - now + 0.999),
            )
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded. Please try again shortly.",
                headers={"Retry-After": str(retry_after)},
            )

        timestamps.append(now)


# --------------------------------------------------
# 5. INPUT VALIDATION
# --------------------------------------------------

class ChannelInputs(BaseModel):

    rf_snr_db: float = Field(ge=-100, le=100)

    fso_snr_db: float = Field(ge=-100, le=100)

    atmospheric_loss_db: float = Field(ge=0, le=100)

    cloud_attenuation_db: float = Field(ge=0, le=100)


class BatchPredictionRequest(BaseModel):

    items: list[ChannelInputs] = Field(max_length=100)


# --------------------------------------------------
# 6. HEALTH CHECK ENDPOINT
# --------------------------------------------------

@app.get("/api/health")
def health():

    return {"status": "ok"}


# --------------------------------------------------
# 7. RF-FSO PREDICTION ENDPOINT
# --------------------------------------------------

@app.post("/api/predict")
def predict(request: Request, inputs: ChannelInputs):

    _check_rate_limit(request, 60)

    # Convert validated inputs into a dictionary.
    values = inputs.model_dump()

    # Preserve the feature order used during model training.
    row = pd.DataFrame(
        [[values[name] for name in FEATURES]],
        columns=FEATURES,
    )

    # Generate model prediction.
    prediction = str(model.predict(row)[0])

    # Calculate class probabilities.
    probabilities = model.predict_proba(row)[0]

    # Convert probabilities into percentages.
    confidence = {
        str(label): round(float(probability) * 100, 2)
        for label, probability in zip(
            model.classes_,
            probabilities,
        )
    }

    return {
        "prediction": prediction,
        "confidence_percent": confidence,
        "inputs": values,
        "model_features": FEATURES,
        "note": (
            "Model prediction from supplied inputs; "
            "not live satellite telemetry."
        ),
    }


@app.post("/api/predict-batch")
def predict_batch(request: Request, inputs: BatchPredictionRequest):

    _check_rate_limit(request, 10)

    values = [item.model_dump() for item in inputs.items]
    if not values:
        return {"results": []}

    rows = pd.DataFrame(
        [[item[name] for name in FEATURES] for item in values],
        columns=FEATURES,
    )
    probabilities = model.predict_proba(rows)
    predictions = model.classes_[probabilities.argmax(axis=1)]

    results = []
    for item, prediction, item_probabilities in zip(values, predictions, probabilities):
        confidence = {
            str(label): round(float(probability) * 100, 2)
            for label, probability in zip(model.classes_, item_probabilities)
        }
        results.append({
            "prediction": str(prediction),
            "confidence_percent": confidence,
            "inputs": item,
            "model_features": FEATURES,
            "note": (
                "Model prediction from supplied inputs; "
                "not live satellite telemetry."
            ),
        })

    return {"results": results}


# --------------------------------------------------
# 8. ROOT ENDPOINT
# --------------------------------------------------

@app.get("/")
def root():

    return {
        "message": "SATCOM Adaptive Link API is running.",
        "health_endpoint": "/api/health",
        "prediction_endpoint": "/api/predict",
    }
