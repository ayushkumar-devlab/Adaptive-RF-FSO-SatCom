
import numpy as np
import pandas as pd
from pathlib import Path

rng = np.random.default_rng(2026)
N = 10_000

# Simulated channel-quality features
rf_snr_db = rng.uniform(0, 20, N)
fso_snr_db = rng.uniform(0, 25, N)

# Illustrative FSO atmospheric attenuation
atmospheric_loss_db = rng.uniform(0, 15, N)
fso_effective_snr_db = fso_snr_db - atmospheric_loss_db

# Other simulated link conditions
cloud_attenuation_db = rng.uniform(0, 10, N)
fso_effective_snr_db -= cloud_attenuation_db

# Estimated link quality after losses
# Label: choose the link with the higher effective SNR.
selected_link = np.where(
    fso_effective_snr_db > rf_snr_db,
    "FSO",
    "RF"
)

df = pd.DataFrame({
    "rf_snr_db": rf_snr_db,
    "fso_snr_db": fso_snr_db,
    "atmospheric_loss_db": atmospheric_loss_db,
    "cloud_attenuation_db": cloud_attenuation_db,
    "fso_effective_snr_db": fso_effective_snr_db,
    "selected_link": selected_link
})

# Save dataset in the project's data folder
output_path = Path("data") / "hybrid_link_dataset.csv"
output_path.parent.mkdir(parents=True, exist_ok=True)
df.to_csv(output_path, index=False)

print("Dataset generated successfully!")
print(f"Rows: {len(df)}")
print(f"Saved to: {output_path.resolve()}")
print("\nClass distribution:")
print(df["selected_link"].value_counts())
print("\nFirst five rows:")
print(df.head())
