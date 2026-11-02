
from pathlib import Path
import os

import joblib
import pandas as pd

from fastapi import FastAPI
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

app = FastAPI(
    title="SATCOM Adaptive Link API",
    description="RF-FSO link prediction using the existing trained model.",
    version="1.0.0",
)


# --------------------------------------------------
# 3. CORS CONFIGURATION
# --------------------------------------------------

# Local development URLs are always allowed. Add deployed frontend origins
# through ALLOWED_ORIGINS as a comma-separated list.
allowed_origins = list(dict.fromkeys([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
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
# 4. INPUT VALIDATION
# --------------------------------------------------

class ChannelInputs(BaseModel):

    rf_snr_db: float = Field(ge=-100, le=100)

    fso_snr_db: float = Field(ge=-100, le=100)

    atmospheric_loss_db: float = Field(ge=0, le=100)

    cloud_attenuation_db: float = Field(ge=0, le=100)


# --------------------------------------------------
# 5. HEALTH CHECK ENDPOINT
# --------------------------------------------------

@app.get("/api/health")
def health():

    return {"status": "ok"}


# --------------------------------------------------
# 6. RF-FSO PREDICTION ENDPOINT
# --------------------------------------------------

@app.post("/api/predict")
def predict(inputs: ChannelInputs):

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


# --------------------------------------------------
# 7. ROOT ENDPOINT
# --------------------------------------------------

@app.get("/")
def root():

    return {
        "message": "SATCOM Adaptive Link API is running.",
        "health_endpoint": "/api/health",
        "prediction_endpoint": "/api/predict",
    }
