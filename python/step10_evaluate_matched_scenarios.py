
from pathlib import Path

import joblib
import pandas as pd
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix

# --------------------------------------------------
# 1. PATHS
# --------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent

DATA_PATH = BASE_DIR / "data" / "matched_rf_fso_scenarios_for_ml.csv"
MODEL_PATH = BASE_DIR / "results" / "rf_fso_random_forest.joblib"
OUTPUT_PATH = BASE_DIR / "results" / "matched_scenario_ml_predictions.csv"

# --------------------------------------------------
# 2. LOAD DATA AND MODEL
# --------------------------------------------------
scenarios = pd.read_csv(DATA_PATH)
saved_data = joblib.load(MODEL_PATH)

model = saved_data["model"]
features = saved_data["features"]

print("Required model features:", features)
print("Scenario rows:", len(scenarios))

# --------------------------------------------------
# 3. MAP SCENARIO VALUES TO MODEL FEATURES
# --------------------------------------------------
# The original training dataset's feature meanings must be
# preserved. These mappings are provisional:
#
# RF SNR -> rf_snr_db
# FSO effective SNR -> fso_snr_db
# FSO attenuation -> atmospheric_loss_db
# Cloud attenuation is unavailable in this CSV.
#
# Do not silently assume that attenuation is cloud attenuation.
# Stop here until a valid cloud attenuation value is available.

required = {
    "rf_snr_db",
    "fso_snr_db",
    "atmospheric_loss_db",
    "cloud_attenuation_db",
}

if set(features) != required:
    raise ValueError(
        "Unexpected saved-model feature set. "
        f"Expected {sorted(required)}, got {features}"
    )

raise RuntimeError(
    "Evaluation paused intentionally: the matched scenario file "
    "does not contain cloud_attenuation_db, and its FSO attenuation "
    "is not necessarily equivalent to the training dataset's "
    "atmospheric_loss_db. Confirm the original feature definitions "
    "before evaluating this model on the new scenarios."
)
