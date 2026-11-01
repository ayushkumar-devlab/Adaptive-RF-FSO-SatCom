import { ProbabilityBars } from "./ProbabilityBars";

type DecisionBannerProps = {
  prediction: string | null;
  confidence: Record<string, number>;
  stale: boolean;
  error: string | null;
};

export function DecisionBanner({
  prediction,
  confidence,
  stale,
  error,
}: DecisionBannerProps) {
  const probabilities = Object.entries(confidence);
  const probabilityText = probabilities.length
    ? probabilities
        .map(([label, value]) => `${value.toFixed(1)}% for ${label}`)
        .join(" · ")
    : "Waiting for the prediction response.";

  return (
    <section className={`decision-banner${stale ? " stale" : ""}`} aria-label="Model result">
      <div className="decision-copy">
        <h2 aria-live="polite" aria-atomic="true">
          {prediction ? `The model picks ${prediction}.` : "Waiting for the model."}
        </h2>
        <p className="decision-probability">{error ?? probabilityText}</p>
        {stale && <p className="stale-label">Last result (stale)</p>}
      </div>
      <ProbabilityBars confidence={confidence} />
    </section>
  );
}
