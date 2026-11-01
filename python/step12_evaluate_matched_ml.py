
from pathlib import Path

import joblib
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    ConfusionMatrixDisplay,
)

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_PATH = BASE_DIR / "data" / "matched_ml_scenarios.csv"
MODEL_PATH = BASE_DIR / "results" / "rf_fso_random_forest.joblib"
OUTPUT_PATH = BASE_DIR / "results" / "matched_ml_predictions.csv"
FIGURE_PATH = BASE_DIR / "results" / "06_ML_Confusion_Matrix.png"

# Load existing data and trained model; do not retrain
df = pd.read_csv(DATA_PATH)
saved_data = joblib.load(MODEL_PATH)

model = saved_data["model"]
features = saved_data["features"]

missing = [col for col in features if col not in df.columns]
if missing:
    raise ValueError(f"Missing model features: {missing}")

X = df[features]
y_true = df["selected_link"]
y_pred = model.predict(X)

# Evaluation
labels = ["RF", "FSO"]
accuracy = accuracy_score(y_true, y_pred)
cm = confusion_matrix(y_true, y_pred, labels=labels)

print("\nMatched-scenario Random Forest evaluation")
print("-" * 45)
print(f"Scenarios evaluated: {len(df)}")
print(f"Accuracy: {accuracy:.4f} ({accuracy * 100:.2f}%)")
print("\nConfusion matrix (rows=true, columns=predicted)")
print("Class order: RF, FSO")
print(cm)

print("\nClassification report:")
print(classification_report(
    y_true, y_pred, labels=labels, zero_division=0
))

# Save predictions
output = df.copy()
output["ml_predicted_link"] = y_pred
output["prediction_correct"] = y_pred == y_true
output.to_csv(OUTPUT_PATH, index=False)

# Plot confusion matrix
fig, ax = plt.subplots(figsize=(7, 6))
display = ConfusionMatrixDisplay(
    confusion_matrix=cm,
    display_labels=labels
)
display.plot(
    ax=ax,
    cmap="Blues",
    values_format="d",
    colorbar=False
)

ax.set_title(
    f"Random Forest Confusion Matrix\nAccuracy: {accuracy * 100:.2f}%",
    fontsize=14,
    fontweight="bold",
    color="black",
    pad=14
)
ax.set_xlabel("Predicted Link", fontsize=12, color="black")
ax.set_ylabel("Actual Link", fontsize=12, color="black")
ax.tick_params(axis="both", labelsize=11, colors="black")

fig.tight_layout()
fig.savefig(
    FIGURE_PATH,
    dpi=300,
    bbox_inches="tight",
    facecolor="white"
)
plt.close(fig)

print(f"\nPredictions saved to: {OUTPUT_PATH}")
print(f"Confusion matrix saved to: {FIGURE_PATH}")
