
from pathlib import Path

import numpy as np
import pandas as pd

# --------------------------------------------------
# 1. PATHS AND REPRODUCIBILITY
# --------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_PATH = BASE_DIR / "data" / "matched_ml_scenarios.csv"

rng = np.random.default_rng(2027)
N = 10_000

# --------------------------------------------------
# 2. GENERATE ALL REQUIRED FEATURES
# --------------------------------------------------
# These ranges and definitions match step6_generate_dataset.py.
scenario = np.arange(1, N + 1)

rf_snr_db = rng.uniform(0, 20, N)
fso_snr_db = rng.uniform(0, 25, N)
atmospheric_loss_db = rng.uniform(0, 15, N)
cloud_attenuation_db = rng.uniform(0, 10, N)

# Calculate effective FSO SNR after both losses.
fso_effective_snr_db = (
    fso_snr_db
    - atmospheric_loss_db
    - cloud_attenuation_db
)

# Preserve the original synthetic labeling rule.
selected_link = np.where(
    fso_effective_snr_db > rf_snr_db,
    "FSO",
    "RF"
)

# --------------------------------------------------
# 3. SAVE THE NEW DATASET
# --------------------------------------------------
df = pd.DataFrame({
    "scenario": scenario,
    "rf_snr_db": rf_snr_db,
    "fso_snr_db": fso_snr_db,
    "atmospheric_loss_db": atmospheric_loss_db,
    "cloud_attenuation_db": cloud_attenuation_db,
    "fso_effective_snr_db": fso_effective_snr_db,
    "selected_link": selected_link,
})

OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
df.to_csv(OUTPUT_PATH, index=False)

print("Matched ML scenario dataset created.")
print(f"Rows: {len(df)}")
print(f"Saved to: {OUTPUT_PATH}")
print("\nClass distribution:")
print(df["selected_link"].value_counts())
print("\nFirst five scenarios:")
print(df.head())
