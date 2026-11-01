import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { predict } from "../api";
import { Panel } from "../components/Panel";
import { theme } from "../theme";
import type { ChannelInputs, PredictionResponse } from "../types";
import { berResults } from "../data/results";
import { createElevationSamples, MASK_ELEVATION_DEG } from "../sim/orbit";

type HistoryEntry = {
  inputs: ChannelInputs;
  response: PredictionResponse;
};

type ResultsProps = {
  inputs: ChannelInputs;
  history: HistoryEntry[];
};

type SweepPoint = {
  rf_snr_db: number;
  [label: string]: number;
};

const lineColor = (label: string) =>
  label === "RF"
    ? theme.rf
    : label === "FSO"
      ? theme.fso
      : theme.textMuted;

export function Results({
  inputs,
  history,
}: ResultsProps) {
  const [sweep, setSweep] = useState<SweepPoint[]>([]);
  const [sweeping, setSweeping] = useState(false);
  const [sweepError, setSweepError] = useState<string | null>(null);

  const runSweep = async () => {
    setSweeping(true);
    setSweepError(null);
    try {
      const points: SweepPoint[] = [];
      for (let rfSnr = -5; rfSnr <= 30; rfSnr += 5) {
        const response = await predict({ ...inputs, rf_snr_db: rfSnr });
        points.push({ rf_snr_db: rfSnr, ...response.confidence_percent });
      }
      setSweep(points);
    } catch (error) {
      setSweepError(
        error instanceof Error ? error.message : "The model sweep failed.",
      );
    } finally {
      setSweeping(false);
    }
  };
  const sweepLabels = Array.from(
    new Set(sweep.flatMap((point) => Object.keys(point).filter((key) => key !== "rf_snr_db"))),
  );
  const elevationSamples = createElevationSamples().map((sample) => ({
    hours: sample.time / 3600,
    elevation: sample.elevation,
    visibleElevation: sample.elevation >= MASK_ELEVATION_DEG ? Math.max(sample.elevation, MASK_ELEVATION_DEG) : 0,
  }));

  return (
    <section className="page-section results-section" id="results">
      <h2 className="section-title">Results</h2>
      <div className="results-charts">
        <Panel title="Model sweep" className="chart-card">
          <div className="chart-heading-row">
            <p>RF SNR input across the slider range; each point is a /api/predict response.</p>
            <button type="button" className="button" onClick={() => void runSweep()} disabled={sweeping}>
              {sweeping ? "Running sweep…" : "Run model sweep"}
            </button>
          </div>
          {sweepError && <p className="chart-error" role="alert">{sweepError}</p>}
          {sweep.length > 0 ? (
            <div className="chart-wrap" role="img" aria-label="Model confidence across RF SNR sweep">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sweep} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                  <CartesianGrid stroke={theme.chartGrid} />
                  <XAxis dataKey="rf_snr_db" type="number" domain={[-5, 30]} tick={{ fill: theme.inkMuted, fontSize: 12 }} label={{ value: "RF SNR (dB)", position: "insideBottom", offset: -4, fill: theme.inkMuted }} />
                  <YAxis tick={{ fill: theme.inkMuted, fontSize: 12 }} unit="%" />
                  <Tooltip contentStyle={{ background: theme.surfaceStrong, border: `1px solid ${theme.border}`, borderRadius: 12, color: theme.text }} />
                  <Legend />
                  {sweepLabels.map((label) => (
                    <Line key={label} type="monotone" dataKey={label} name={`${label} probability`} stroke={lineColor(label)} strokeWidth={2} strokeDasharray={label === "FSO" ? "6 4" : undefined} dot />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="chart-empty">Run the sweep to collect model responses.</p>
          )}
        </Panel>
        <Panel title="Strategy comparison" className="chart-card">
          <p>Source: README §6 · synthetic dataset</p>
          <div className="chart-wrap" role="img" aria-label="README section 6 mean theoretical BER by strategy">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={berResults} margin={{ top: 8, right: 12, bottom: 8, left: 16 }}>
                <CartesianGrid stroke={theme.chartGrid} />
                <XAxis dataKey="strategy" tick={{ fill: theme.inkMuted, fontSize: 12 }} />
                <YAxis scale="log" domain={["dataMin", "dataMax"]} tick={{ fill: theme.inkMuted, fontSize: 12 }} />
                <Tooltip contentStyle={{ background: theme.surfaceStrong, border: `1px solid ${theme.border}`, borderRadius: 12, color: theme.text }} />
                <Bar dataKey="ber" name="Mean theoretical BER" fill={theme.inkMuted} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Satellite elevation over the station" className="chart-card">
          <p>Geometry only · assumed orbit.</p>
          <div className="chart-wrap" role="img" aria-label="Satellite elevation over the station">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={elevationSamples} margin={{ top: 8, right: 12, bottom: 20, left: 8 }}>
                <CartesianGrid stroke={theme.chartGrid} />
                <XAxis dataKey="hours" type="number" domain={[0, 24]} ticks={[0, 4, 8, 12, 16, 20, 24]} tickFormatter={(value: number) => `${value} h`} label={{ value: "Time (hours)", position: "insideBottom", offset: -12, fill: theme.inkMuted }} />
                <YAxis unit="°" label={{ value: "Elevation (degrees)", angle: -90, position: "insideLeft", fill: theme.inkMuted }} />
                <Tooltip
                  contentStyle={{ background: theme.surfaceStrong, border: `1px solid ${theme.border}`, borderRadius: 12, color: theme.text }}
                  formatter={(value) => [Number(value) >= MASK_ELEVATION_DEG ? `Elevation: ${Math.round(Number(value))}°` : "Below horizon", ""]}
                />
                <ReferenceLine y={MASK_ELEVATION_DEG} stroke={theme.textMuted} strokeDasharray="5 5" label={{ value: "mask (assumed)", fill: theme.textMuted, fontSize: 12 }} />
                <Area type="stepAfter" dataKey="visibleElevation" name="Elevation" stroke={theme.rf} fill={theme.rf} fillOpacity={0.28} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
      <Panel title="Session history" className="history-card">
        {history.length ? (
          <ol className="history-list">
            {history.map(({ inputs: itemInputs, response }, index) => (
              <li key={`${index}-${response.prediction}`}>
                <strong>{response.prediction}</strong>
                <span>RF {itemInputs.rf_snr_db} dB · FSO {itemInputs.fso_snr_db} dB</span>
                <span>{Object.entries(response.confidence_percent).map(([label, value]) => `${label} ${value.toFixed(1)}%`).join(" · ")}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p>Model responses from this session will appear here.</p>
        )}
      </Panel>
    </section>
  );
}
