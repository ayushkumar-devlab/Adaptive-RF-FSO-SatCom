
import pandas as pd
import joblib

from pathlib import Path
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
)

# Project paths (works regardless of terminal directory)
PROJECT_DIR = Path(__file__).resolve().parent.parent
DATA_PATH = PROJECT_DIR / "data" / "hybrid_link_dataset.csv"
MODEL_PATH = PROJECT_DIR / "results" / "rf_fso_random_forest.joblib"

# Load simulated dataset
df = pd.read_csv(DATA_PATH)

features = [
    "rf_snr_db",
    "fso_snr_db",
    "atmospheric_loss_db",
    "cloud_attenuation_db",
]

X = df[features]
y = df["selected_link"]

# Keep test data separate from training data
X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.20,
    random_state=42,
    stratify=y,
)

# Train model
model = RandomForestClassifier(
    n_estimators=200,
    random_state=42,
    class_weight="balanced",
)

model.fit(X_train, y_train)

# Evaluate on held-out test data
predictions = model.predict(X_test)

print("Random Forest RF-FSO Link Selection")
print("-" * 45)
print(f"Training samples: {len(X_train)}")
print(f"Testing samples:  {len(X_test)}")
print(f"Accuracy: {accuracy_score(y_test, predictions):.4f}")

print("\nClassification report:")
print(
    classification_report(
        y_test,
        predictions,
        labels=["RF", "FSO"],
        zero_division=0,
    )
)

print("Confusion matrix (rows=true, columns=predicted)")
print("Class order: RF, FSO")
print(confusion_matrix(y_test, predictions, labels=["RF", "FSO"]))

# Save trained model and feature order
MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)

joblib.dump(
    {"model": model, "features": features},
    MODEL_PATH,
)

print(f"\nModel saved to: {MODEL_PATH}")
