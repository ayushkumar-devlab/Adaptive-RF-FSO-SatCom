import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  LabelList,
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
import { API_BASE_URL, ApiHttpError, ApiTimeoutError, health, predict } from "../api";
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

const sweepRange = Array.from({ length: 36 }, (_, index) => index - 5);
const sweepBatchSize = 6;
const retryBackoffMs = [1_000, 3_000];

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
  const [sweepProgress, setSweepProgress] = useState(0);
  const [wakingServer, setWakingServer] = useState(false);

  const predictWithRetry = async (rfSnr: number): Promise<PredictionResponse> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await predict({ ...inputs, rf_snr_db: rfSnr });
      } catch (error) {
        const delay = retryBackoffMs[attempt];
        if (delay === undefined) throw error;
        await new Promise((resolve) => window.setTimeout(resolve, delay));
      }
    }
  };

  const runSweep = async () => {
    setSweeping(true);
    setWakingServer(true);
    setSweepError(null);
    setSweepProgress(0);
    let phase: "health" | "predict" = "health";
    try {
      await health();
      phase = "predict";
      setWakingServer(false);
      const points: SweepPoint[] = [];
      for (let start = 0; start < sweepRange.length; start += sweepBatchSize) {
        const batch = sweepRange.slice(start, start + sweepBatchSize);
        const results = await Promise.all(batch.map(async (rfSnr) => {
          try {
            return { ok: true as const, rfSnr, response: await predictWithRetry(rfSnr) };
          } catch (error) {
            return { ok: false as const, rfSnr, error };
          } finally {
            setSweepProgress((progress) => progress + 1);
          }
        }));
        const failed = results.find((result) => !result.ok);
        if (failed && !failed.ok) throw failed.error;
        points.push(
          ...results.map((result) => {
            if (!result.ok) throw result.error;
            const { response, rfSnr } = result;
            if (response.prediction !== "RF" && response.prediction !== "FSO") {
              throw new Error(`The API returned an unknown link label: ${response.prediction}`);
            }
            if (response.inputs.rf_snr_db !== rfSnr) {
              throw new Error(`The sweep response did not match its RF SNR input (${rfSnr} dB).`);
            }
            return { rf_snr_db: rfSnr, ...response.confidence_percent };
          }),
        );
      }
      setSweep(points);
    } catch (error) {
      const endpoint = error instanceof ApiHttpError || error instanceof ApiTimeoutError
        ? error.url
        : phase === "health"
          ? `${API_BASE_URL}/api/health`
          : `${API_BASE_URL}/api/predict`;
      console.error("Model sweep failed.", {
        endpoint,
        inputs,
        error,
      });
      if (error instanceof ApiTimeoutError) {
        setSweepError(`Timeout: ${error.message}`);
      } else if (error instanceof ApiHttpError) {
        setSweepError(`HTTP status ${error.status} from ${error.url}.`);
      } else if (error instanceof TypeError) {
        setSweepError(`CORS/network failure contacting ${endpoint}. Check the backend URL and allowed frontend origins. (${error.message})`);
      } else {
        setSweepError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setWakingServer(false);
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
              {sweeping ? `Running… ${sweepProgress}/${sweepRange.length}` : "Run model sweep"}
            </button>
          </div>
          {wakingServer && (
            <p role="status">Waking up the server, this can take up to a minute on the free tier…</p>
          )}
          {sweepError && (
            <div className="chart-error" role="alert">
              <p>{sweepError}</p>
              <button type="button" className="button" onClick={() => void runSweep()} disabled={sweeping}>
                Retry
              </button>
            </div>
          )}
          {sweep.length > 0 ? (
            <div className="chart-wrap model-sweep-chart" role="img" aria-label="Model confidence across RF SNR sweep">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sweep} margin={{ top: 8, right: 16, left: 0, bottom: 28 }}>
                  <CartesianGrid stroke={theme.chartGrid} />
                  <XAxis dataKey="rf_snr_db" type="number" domain={[-5, 30]} ticks={[-5, 0, 5, 10, 15, 20, 25, 30]} height={30} tick={{ fill: theme.inkMuted, fontSize: 12 }} label={{ value: "RF SNR (dB)", position: "insideBottom", offset: -4, fill: theme.inkMuted }} />
                  <YAxis tick={{ fill: theme.inkMuted, fontSize: 12 }} unit="%" />
                  <Tooltip contentStyle={{ background: theme.surfaceStrong, border: `1px solid ${theme.border}`, borderRadius: 12, color: theme.text }} />
                  <Legend verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: 14 }} iconType="plainline" />
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
          <p>Source: Project README – Strategy Comparison | Synthetic Dataset</p>
          <div className="chart-wrap" role="img" aria-label="Mean theoretical BER by strategy">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={berResults} margin={{ top: 24, right: 12, bottom: 8, left: 16 }}>
                <CartesianGrid stroke={theme.chartGrid} />
                <XAxis dataKey="strategy" tick={{ fill: theme.inkMuted, fontSize: 12 }} />
                <YAxis
                  type="number"
                  scale="linear"
                  domain={[0, 0.15]}
                  ticks={[0, 0.03, 0.06, 0.09, 0.12, 0.15]}
                  tick={{ fill: theme.inkMuted, fontSize: 12 }}
                />
                <Tooltip contentStyle={{ background: theme.surfaceStrong, border: `1px solid ${theme.border}`, borderRadius: 12, color: theme.text }} />
                <Bar dataKey="ber" name="Mean theoretical BER" fill={theme.rf} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  <LabelList
                    dataKey="ber"
                    position="top"
                    formatter={(value) => Number(value).toFixed(6)}
                    fill={theme.inkMuted}
                    fontSize={10}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Satellite elevation over the station" className="chart-card">
          <p>Geometry only · assumed orbit.</p>
          <div className="chart-wrap" role="img" aria-label="Satellite elevation over the station">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={elevationSamples} margin={{ top: 8, right: 12, bottom: 20, left: 36 }}>
                <CartesianGrid stroke={theme.chartGrid} />
                <XAxis dataKey="hours" type="number" domain={[0, 24]} ticks={[0, 4, 8, 12, 16, 20, 24]} tickFormatter={(value: number) => `${value} h`} label={{ value: "Time (hours)", position: "insideBottom", offset: -12, fill: theme.inkMuted }} />
                <YAxis ticks={[0, 15, 30, 45, 60]} unit="°" label={{ value: "Elevation (degrees)", angle: -90, position: "insideLeft", textAnchor: "middle", fill: theme.inkMuted }} />
                <Tooltip
                  contentStyle={{ background: theme.surfaceStrong, border: `1px solid ${theme.border}`, borderRadius: 12, color: theme.text }}
                  formatter={(value) => [Number(value) >= MASK_ELEVATION_DEG ? `Elevation: ${Math.round(Number(value))}°` : "Below horizon", ""]}
                />
                <ReferenceLine y={MASK_ELEVATION_DEG} stroke={theme.textMuted} strokeDasharray="5 5" label={{ value: "mask (assumed)", position: "insideTop", offset: 8, fill: theme.textMuted, fontSize: 12 }} />
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
