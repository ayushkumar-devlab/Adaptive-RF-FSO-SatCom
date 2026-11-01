
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy.special import erfc

# --------------------------------------------------
# 1. Paths
# --------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_FILE = BASE_DIR / "data" / "matched_ml_scenarios.csv"
MODEL_FILE = BASE_DIR / "results" / "rf_fso_random_forest.joblib"
RESULTS_DIR = BASE_DIR / "results"

RESULTS_DIR.mkdir(parents=True, exist_ok=True)

# --------------------------------------------------
# 2. Load data and model
# --------------------------------------------------
df = pd.read_csv(DATA_FILE)
saved = joblib.load(MODEL_FILE)

model = saved["model"]
features = saved["features"]

required = ["rf_snr_db", "fso_effective_snr_db"]
missing = [col for col in required if col not in df.columns]

if missing:
    raise ValueError(f"Missing required columns: {missing}")

if len(df) != 10000:
    print(f"Note: evaluating {len(df)} scenarios, not 10,000.")

rf_snr_db = df["rf_snr_db"].to_numpy(dtype=float)
fso_snr_db = df["fso_effective_snr_db"].to_numpy(dtype=float)

# --------------------------------------------------
# 3. Calculate theoretical coherent BPSK BER
# BER = 0.5 * erfc(sqrt(linear SNR))
# --------------------------------------------------
def bpsk_ber(snr_db):
    snr_linear = 10 ** (np.asarray(snr_db) / 10.0)
    return 0.5 * erfc(np.sqrt(snr_linear))

rf_ber = bpsk_ber(rf_snr_db)
fso_ber = bpsk_ber(fso_snr_db)

# --------------------------------------------------
# 4. Select links using each strategy
# --------------------------------------------------
rf_only_ber = rf_ber
fso_only_ber = fso_ber

# Rule-based selector uses higher effective SNR
rule_select_fso = fso_snr_db > rf_snr_db
rule_based_ber = np.where(rule_select_fso, fso_ber, rf_ber)

# Random Forest predictions
X = df[features]
ml_predictions = np.char.upper(model.predict(X).astype(str))
ml_select_fso = ml_predictions == "FSO"

ml_based_ber = np.where(ml_select_fso, fso_ber, rf_ber)

# --------------------------------------------------
# 5. Summarize average theoretical BER
# --------------------------------------------------
strategies = {
    "RF-only": rf_only_ber,
    "FSO-only": fso_only_ber,
    "Rule-based": rule_based_ber,
    "Random Forest": ml_based_ber,
}

rows = []
for name, values in strategies.items():
    rows.append({
        "Strategy": name,
        "Mean_Theoretical_BER": float(np.mean(values)),
        "Median_Theoretical_BER": float(np.median(values)),
        "Scenarios": len(values),
    })

results = pd.DataFrame(rows)

# Percentage reduction relative to each fixed-link baseline
rf_mean = float(np.mean(rf_only_ber))
fso_mean = float(np.mean(fso_only_ber))

results["Reduction_vs_RF_percent"] = (
    (rf_mean - results["Mean_Theoretical_BER"]) / rf_mean * 100
)
results["Reduction_vs_FSO_percent"] = (
    (fso_mean - results["Mean_Theoretical_BER"]) / fso_mean * 100
)

csv_path = RESULTS_DIR / "step14_ber_strategy_comparison.csv"
results.to_csv(csv_path, index=False)

print("\nTHEORETICAL BPSK BER COMPARISON")
print("=" * 78)
print(results.to_string(index=False, float_format=lambda x: f"{x:.8g}"))
print(f"\nCSV saved to: {csv_path}")

# --------------------------------------------------
# 6. Plot average theoretical BER
# --------------------------------------------------
plt.figure(figsize=(10, 6))

bars = plt.bar(
    results["Strategy"],
    results["Mean_Theoretical_BER"],
)

plt.title("Average Theoretical BPSK BER by Strategy", color="black")
plt.xlabel("Link-selection strategy", color="black")
plt.ylabel("Mean theoretical BER", color="black")
plt.yscale("log")
plt.xticks(rotation=10, color="black")
plt.yticks(color="black")
plt.grid(axis="y", linestyle="--", alpha=0.35)

for bar, value in zip(bars, results["Mean_Theoretical_BER"]):
    plt.annotate(
        f"{value:.3g}",
        (bar.get_x() + bar.get_width() / 2, value),
        xytext=(0, 5),
        textcoords="offset points",
        ha="center",
        color="black",
        fontsize=9,
    )

plt.tight_layout()

plot_path = RESULTS_DIR / "step14_ber_strategy_comparison.png"
plt.savefig(plot_path, dpi=300, bbox_inches="tight")
plt.close()

# --------------------------------------------------
# 7. Save per-scenario BER values for audit
# --------------------------------------------------
per_scenario = pd.DataFrame({
    "Scenario": np.arange(1, len(df) + 1),
    "RF_SNR_dB": rf_snr_db,
    "FSO_Effective_SNR_dB": fso_snr_db,
    "RF_Theoretical_BER": rf_ber,
    "FSO_Theoretical_BER": fso_ber,
    "Rule_Based_Theoretical_BER": rule_based_ber,
    "ML_Theoretical_BER": ml_based_ber,
    "ML_Selected_Link": ml_predictions,
})

detail_path = RESULTS_DIR / "step14_per_scenario_ber.csv"
per_scenario.to_csv(detail_path, index=False)

print(f"Plot saved to: {plot_path}")
print(f"Per-scenario details saved to: {detail_path}")
print("\nStep 45 completed successfully.")
