
from pathlib import Path
import json

import joblib
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
)

# Project paths
ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "hybrid_link_dataset.csv"
MODEL_PATH = ROOT / "results" / "rf_fso_random_forest.joblib"
RESULTS_DIR = ROOT / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

# Load dataset
df = pd.read_csv(DATA_PATH)

# Load saved dictionary and extract the trained model and features
saved_data = joblib.load(MODEL_PATH)
model = saved_data["model"]
features = saved_data["features"]

target = "selected_link"

# Validate required columns
missing = [col for col in features + [target] if col not in df.columns]
if missing:
    raise ValueError(f"Missing required dataset columns: {missing}")

X = df[features]
y_true = df[target]

# Predict using the saved Random Forest
y_pred = model.predict(X)

# Calculate metrics
labels = ["RF", "FSO"]
accuracy = accuracy_score(y_true, y_pred)
cm = confusion_matrix(y_true, y_pred, labels=labels)

report_text = classification_report(
    y_true,
    y_pred,
    labels=labels,
    zero_division=0,
)

report_dict = classification_report(
    y_true,
    y_pred,
    labels=labels,
    output_dict=True,
    zero_division=0,
)

# Display results
print(f"Dataset rows: {len(df)}")
print(f"Features used: {features}")
print(f"Accuracy on full dataset: {accuracy:.4f}")

print("\nConfusion matrix (rows=true, columns=predicted):")
print(
    pd.DataFrame(
        cm,
        index=[f"True {label}" for label in labels],
        columns=[f"Predicted {label}" for label in labels],
    )
)

print("\nClassification report:")
print(report_text)

# Save predictions
output = df.copy()
output["predicted_link"] = y_pred
predictions_path = RESULTS_DIR / "ml_link_predictions.csv"
output.to_csv(predictions_path, index=False)

# Save metrics
metrics = {
    "dataset_rows": int(len(df)),
    "accuracy_full_dataset": float(accuracy),
    "confusion_matrix_labels": labels,
    "confusion_matrix": cm.tolist(),
    "classification_report": report_dict,
    "note": (
        "Evaluation on the full dataset is a diagnostic only, "
        "not an independent test-set performance estimate. "
        "Labels are generated from a synthetic rule."
    ),
}

metrics_path = RESULTS_DIR / "ml_evaluation_metrics.json"
with open(metrics_path, "w", encoding="utf-8") as f:
    json.dump(metrics, f, indent=2)

print("\nFiles saved:")
print(predictions_path)
print(metrics_path)
