type ProbabilityBarsProps = {
  confidence: Record<string, number>;
};

function classNameForLink(label: string) {
  return label === "RF" ? "rf" : label === "FSO" ? "fso" : "other";
}

export function ProbabilityBars({ confidence }: ProbabilityBarsProps) {
  return (
    <div className="probability-list" aria-label="Model class probabilities">
      {Object.entries(confidence).map(([label, percentage]) => {
        const value = Math.min(100, Math.max(0, percentage));
        return (
          <div className={`probability-row ${classNameForLink(label)}`} key={label}>
            <div className="probability-label">
              <span>{label}</span>
              <strong>{percentage.toFixed(1)}%</strong>
            </div>
            <div
              className="probability-track"
              role="meter"
              aria-label={`${label} probability`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={value}
            >
              <span style={{ width: `${value}%` }} />
            </div>
          </div>
        );
      })}
      {Object.keys(confidence).length === 0 && (
        <p className="empty-state">Probabilities appear after the model responds.</p>
      )}
    </div>
  );
}
