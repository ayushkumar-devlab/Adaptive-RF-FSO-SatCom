
from pathlib import Path
import json
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
RESULTS_DIR = BASE_DIR / "results"

strategy_file = RESULTS_DIR / "step13_final_strategy_comparison.csv"
ber_file = RESULTS_DIR / "step14_ber_strategy_comparison.csv"
metrics_file = RESULTS_DIR / "ml_evaluation_metrics.json"

# Check required files
for path in [strategy_file, ber_file]:
    if not path.exists():
        raise FileNotFoundError(f"Required result file not found: {path}")

# Load results
strategy = pd.read_csv(strategy_file)
ber = pd.read_csv(ber_file)

# Merge accuracy and BER by strategy
summary = strategy.merge(ber, on="Strategy", how="outer")

# Save consolidated CSV
csv_path = RESULTS_DIR / "final_satcom_results_summary.csv"
summary.to_csv(csv_path, index=False)

# Create report
report_path = RESULTS_DIR / "final_satcom_results_report.txt"

lines = [
    "SATELLITE AND OPTICAL COMMUNICATION PROJECT",
    "FINAL RESULTS SUMMARY",
    "=" * 55,
    "",
    "EXPERIMENT DETAILS",
    "Scenario count: 10,000 expected (check CSV for actual count)",
    "BER method: theoretical coherent BPSK over an AWGN-equivalent model",
    "FSO limitation: effective-SNR proxy, not a complete physical optical channel",
    "ML labels: synthetic labels generated from an SNR-based selection rule",
    "",
    "STRATEGY COMPARISON",
    "-" * 55,
    summary.to_string(index=False),
    "",
    "INTERPRETATION",
    "-" * 55,
    "Rule-based selection achieves 100% accuracy against the synthetic labels",
    "because those labels were generated using the same SNR selection rule.",
    "Random Forest accuracy measures how closely it learns that rule.",
    "The theoretical BER results are model-based estimates, not hardware measurements.",
    "These experiments alone do not establish real-world satellite-link performance.",
]

if metrics_file.exists():
    try:
        with open(metrics_file, "r", encoding="utf-8") as f:
            metrics = json.load(f)
        lines += [
            "",
            "EXISTING ML EVALUATION METRICS",
            "-" * 55,
            json.dumps(metrics, indent=2),
        ]
    except (json.JSONDecodeError, OSError) as exc:
        lines += [f"\nCould not read ML metrics file: {exc}"]

report_path.write_text("\n".join(lines), encoding="utf-8")

print("FINAL SATCOM SUMMARY GENERATED")
print("=" * 45)
print(f"Consolidated CSV: {csv_path}")
print(f"Text report:      {report_path}")
print("\nSummary preview:")
print(summary.to_string(index=False))
print("\nStep 46 completed successfully.")
