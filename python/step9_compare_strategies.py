
from pathlib import Path

import matplotlib
matplotlib.use("Agg")

import matplotlib.pyplot as plt
import pandas as pd
import joblib

from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report


# Paths
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_PATH = BASE_DIR / "data" / "hybrid_link_dataset.csv"
MODEL_PATH = BASE_DIR / "results" / "rf_fso_random_forest.joblib"
RESULTS_DIR = BASE_DIR / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

# Load dataset and trained model
df = pd.read_csv(DATA_PATH)
saved_data = joblib.load(MODEL_PATH)

model = saved_data["model"]
features = saved_data["features"]

X = df[features]
y = df["selected_link"]

# Recreate the held-out split
_, X_test, _, y_test = train_test_split(
    X,
    y,
    test_size=0.20,
    random_state=42,
    stratify=y
)

test_df = df.loc[X_test.index].copy()
y_test = y_test.loc[X_test.index]

# Strategy 1: Always choose RF
rf_predictions = pd.Series("RF", index=X_test.index)

# Strategy 2: Choose the link with higher effective SNR
rule_predictions = pd.Series(
    [
        "FSO" if fso > rf else "RF"
        for fso, rf in zip(
            test_df["fso_effective_snr_db"],
            test_df["rf_snr_db"]
        )
    ],
    index=X_test.index
)

# Strategy 3: Random Forest ML predictions
ml_predictions = pd.Series(
    model.predict(X_test),
    index=X_test.index
)

strategies = {
    "RF-only": rf_predictions,
    "Rule-based": rule_predictions,
    "ML-based": ml_predictions
}

# Calculate selection accuracy
rows = []

for name, predictions in strategies.items():
    rows.append({
        "Strategy": name,
        "Selection_Accuracy": accuracy_score(y_test, predictions),
        "Accuracy_Percent": accuracy_score(y_test, predictions) * 100
    })

comparison = pd.DataFrame(rows)

comparison.to_csv(
    RESULTS_DIR / "strategy_comparison.csv",
    index=False
)

# Save predictions
pd.DataFrame({
    "Actual_Link": y_test,
    "RF_Only_Prediction": rf_predictions,
    "Rule_Based_Prediction": rule_predictions,
    "ML_Based_Prediction": ml_predictions
}).to_csv(RESULTS_DIR / "strategy_test_predictions.csv")

# Save classification report
report = classification_report(
    y_test,
    ml_predictions,
    labels=["RF", "FSO"],
    output_dict=True,
    zero_division=0
)

pd.DataFrame(report).transpose().to_csv(
    RESULTS_DIR / "strategy_ml_test_report.csv"
)

# Create graph
fig, ax = plt.subplots(figsize=(10, 6))

names = comparison["Strategy"].tolist()
values = comparison["Selection_Accuracy"].tolist()

bars = ax.bar(names, values, width=0.70)

ax.set_title(
    "Held-out Link Selection: Strategy Comparison",
    pad=20
)
ax.set_xlabel("Selection Strategy", labelpad=10)
ax.set_ylabel("Selection Accuracy", labelpad=10)

# IMPORTANT: increase upper limit to leave clear space above 1.000
ax.set_ylim(0, 1.20)
ax.set_yticks([0.0, 0.2, 0.4, 0.6, 0.8, 1.0])

ax.grid(axis="y", alpha=0.25)
ax.set_axisbelow(True)

# Labels positioned with more vertical spacing
for bar, value in zip(bars, values):
    ax.text(
        bar.get_x() + bar.get_width() / 2,
        value + 0.025,
        f"{value:.3f}",
        ha="center",
        va="bottom",
        fontsize=13
    )

fig.tight_layout()

output_path = RESULTS_DIR / "strategy_comparison.png"
fig.savefig(output_path, dpi=300, bbox_inches="tight", facecolor="white")
plt.close(fig)

print("\nStrategy comparison:")
print(comparison.to_string(index=False))
print(f"\nGraph regenerated at:\n{output_path.resolve()}")
print(f"File modification time: {pd.Timestamp(output_path.stat().st_mtime, unit='s')}")
print("\nAccuracy reflects agreement with synthetic labels, not measured BER improvement.")
