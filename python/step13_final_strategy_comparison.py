
from pathlib import Path

import numpy as np
import pandas as pd
import joblib
import matplotlib.pyplot as plt
from sklearn.metrics import accuracy_score

# --------------------------------------------------
# 1. Define project paths
# --------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_FILE = BASE_DIR / "data" / "matched_ml_scenarios.csv"
MODEL_FILE = BASE_DIR / "results" / "rf_fso_random_forest.joblib"
RESULTS_DIR = BASE_DIR / "results"

RESULTS_DIR.mkdir(parents=True, exist_ok=True)

# --------------------------------------------------
# 2. Load scenarios and trained model
# --------------------------------------------------
df = pd.read_csv(DATA_FILE)
saved = joblib.load(MODEL_FILE)

model = saved["model"]
features = saved["features"]

required_columns = [
    "rf_snr_db",
    "fso_effective_snr_db",
    "selected_link",
]

missing = [col for col in required_columns if col not in df.columns]
if missing:
    raise ValueError(f"Missing required columns: {missing}")

X = df[features]
y_true = df["selected_link"].astype(str).str.upper()

# --------------------------------------------------
# 3. Generate the four strategies
# --------------------------------------------------
rf_snr = df["rf_snr_db"].to_numpy()
fso_snr = df["fso_effective_snr_db"].to_numpy()

# Always select RF or FSO
rf_only = np.full(len(df), "RF")
fso_only = np.full(len(df), "FSO")

# Rule-based selection: choose higher effective SNR
rule_based = np.where(fso_snr > rf_snr, "FSO", "RF")

# Random Forest predictions
ml_predictions = np.char.upper(model.predict(X).astype(str))

# --------------------------------------------------
# 4. Compare selection accuracy
# --------------------------------------------------
strategies = {
    "RF-only": rf_only,
    "FSO-only": fso_only,
    "Rule-based": rule_based,
    "Random Forest": ml_predictions,
}

rows = []

for name, predictions in strategies.items():
    accuracy = accuracy_score(y_true, predictions)

    rows.append({
        "Strategy": name,
        "Selection_Accuracy": accuracy,
        "Accuracy_Percent": round(accuracy * 100, 2),
        "Correct_Selections": int(np.sum(predictions == y_true)),
        "Total_Scenarios": len(df),
    })

comparison = pd.DataFrame(rows)

# --------------------------------------------------
# 5. Save comparison table
# --------------------------------------------------
csv_path = RESULTS_DIR / "step13_final_strategy_comparison.csv"
comparison.to_csv(csv_path, index=False)

print("\nFINAL STRATEGY COMPARISON")
print("=" * 65)
print(comparison.to_string(index=False))
print(f"\nComparison CSV saved to: {csv_path}")

# --------------------------------------------------
# 6. Plot selection accuracy
# --------------------------------------------------
plt.figure(figsize=(10, 6))

bars = plt.bar(
    comparison["Strategy"],
    comparison["Accuracy_Percent"]
)

plt.title("Link-Selection Accuracy Across Strategies",
          color="black", fontsize=14)
plt.xlabel("Selection Strategy", color="black")
plt.ylabel("Selection Accuracy (%)", color="black")
plt.ylim(0, 105)
plt.yticks(color="black")
plt.xticks(rotation=10, color="black")
plt.grid(axis="y", linestyle="--", alpha=0.35)

for bar, value in zip(bars, comparison["Accuracy_Percent"]):
    plt.text(
        bar.get_x() + bar.get_width() / 2,
        bar.get_height() + 1,
        f"{value:.2f}%",
        ha="center",
        va="bottom",
        color="black",
    )

plt.tight_layout()

plot_path = RESULTS_DIR / "step13_final_strategy_comparison.png"
plt.savefig(plot_path, dpi=300, bbox_inches="tight")
plt.close()

print(f"Comparison plot saved to: {plot_path}")
print("\nStep 44 completed successfully.")
