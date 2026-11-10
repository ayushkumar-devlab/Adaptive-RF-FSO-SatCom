import { useEffect, useRef, useState } from "react";
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
import { API_BASE_URL, ApiHttpError, ApiTimeoutError, predict } from "../api";
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
  apiReady: boolean;
};

type SweepPoint = {
  rf_snr_db: number;
  [label: string]: number;
};

const sweepRange = Array.from({ length: 36 }, (_, index) => index - 5);
const sweepWorkerCount = 6;
const retryBackoffMs = [1_000, 3_000];

const getSweepCacheKey = (inputs: ChannelInputs) => {
  const source = JSON.stringify([
    inputs.fso_snr_db,
    inputs.atmospheric_loss_db,
    inputs.cloud_attenuation_db,
    inputs.cloud_attenuation_db > 0,
  ]);
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index += 1) {
    hash = Math.imul(hash ^ source.charCodeAt(index), 16_777_619);
  }
  return (hash >>> 0).toString(36);
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
  apiReady,
}: ResultsProps) {
  const [sweep, setSweep] = useState<SweepPoint[]>([]);
  const [sweepCache, setSweepCache] = useState<Record<string, SweepPoint[]>>({});
  const [sweeping, setSweeping] = useState(false);
  const [sweepError, setSweepError] = useState<string | null>(null);
  const [sweepProgress, setSweepProgress] = useState<number | null>(null);
  const [sweepPhase, setSweepPhase] = useState<"waking" | "processing" | null>(null);
  const [wakingSeconds, setWakingSeconds] = useState(0);
  const cacheRef = useRef(sweepCache);
  const inFlightRef = useRef(new Map<string, Promise<SweepPoint[]>>());
  const activeRequestRef = useRef<{ key: string; controller: AbortController } | null>(null);
  const requestIdRef = useRef(0);
  const initialPrefetchRef = useRef(false);
  const latestInputsRef = useRef(inputs);
  const currentKey = getSweepCacheKey(inputs);
  const currentKeyRef = useRef(currentKey);

  useEffect(() => {
    latestInputsRef.current = inputs;
    currentKeyRef.current = currentKey;
    cacheRef.current = sweepCache;
  }, [inputs, currentKey, sweepCache]);

  const predictWithRetry = async (
    requestInputs: ChannelInputs,
    signal: AbortSignal,
  ): Promise<PredictionResponse> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await predict(requestInputs, signal);
      } catch (error) {
        if (signal.aborted) throw error;
        const delay = retryBackoffMs[attempt];
        if (delay === undefined) throw error;
        await new Promise((resolve) => window.setTimeout(resolve, delay));
      }
    }
  };

  const toSweepPoint = (response: PredictionResponse, rfSnr: number): SweepPoint => {
    if (response.prediction !== "RF" && response.prediction !== "FSO") {
      throw new Error(`The API returned an unknown link label: ${response.prediction}`);
    }
    if (response.inputs.rf_snr_db !== rfSnr) {
      throw new Error(`The sweep response did not match its RF SNR input (${rfSnr} dB).`);
    }
    return { rf_snr_db: rfSnr, ...response.confidence_percent };
  };

  const loadSweep = async (
    requestInputs: ChannelInputs,
    key: string,
  ): Promise<SweepPoint[]> => {
    const cached = cacheRef.current[key];
    if (cached) {
      if (currentKeyRef.current === key) setSweep(cached);
      return cached;
    }
    const existing = inFlightRef.current.get(key);
    if (existing) return existing;

    activeRequestRef.current?.controller.abort();
    const controller = new AbortController();
    activeRequestRef.current = { key, controller };
    const requestId = ++requestIdRef.current;
    const startedAt = performance.now();
    const items = sweepRange.map((rfSnr) => ({ ...requestInputs, rf_snr_db: rfSnr }));
    const batchUrl = `${API_BASE_URL}/api/predict-batch`;
    let path: "batch" | "fallback" = "batch";
    let timedOut = false;
    let processingShown = false;
    let progress = 0;
    const isCurrent = () => currentKeyRef.current === key && requestIdRef.current === requestId;

    setSweeping(true);
    setSweepError(null);
    setSweepProgress(null);
    setSweepPhase(null);
    setWakingSeconds(0);
    const wakeDelay = window.setTimeout(() => {
      if (isCurrent()) {
        setSweepPhase("waking");
        setWakingSeconds(Math.floor((performance.now() - startedAt) / 1000));
      }
    }, 2_000);
    const wakeClock = window.setInterval(() => {
      const elapsedSeconds = Math.floor((performance.now() - startedAt) / 1000);
      if (elapsedSeconds >= 2 && isCurrent()) {
        setSweepPhase("waking");
        setWakingSeconds(elapsedSeconds);
      }
    }, 1_000);
    const markProcessing = () => {
      if (processingShown) return;
      processingShown = true;
      window.clearTimeout(wakeDelay);
      window.clearInterval(wakeClock);
      if (isCurrent()) setSweepPhase("processing");
    };
    const batchTimeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 90_000);
    const request = (async () => {
      try {
        let response: Response;
        try {
          response = await fetch(batchUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items }),
            signal: controller.signal,
          });
        } catch (error) {
          if (timedOut) throw new ApiTimeoutError(90_000, batchUrl);
          throw error;
        }

        let points: SweepPoint[];
        if (response.status === 404) {
          path = "fallback";
          if (isCurrent()) setSweepProgress(0);
          const results: Array<PredictionResponse | undefined> = new Array(items.length);
          let nextIndex = 0;
          let hasFailed = false;
          let firstError: unknown;
          const worker = async () => {
            while (nextIndex < items.length && !hasFailed) {
              const index = nextIndex++;
              try {
                const result = await predictWithRetry(items[index], controller.signal);
                markProcessing();
                results[index] = result;
              } catch (error) {
                if (!hasFailed) {
                  hasFailed = true;
                  firstError = error;
                }
              } finally {
                progress += 1;
                if (isCurrent()) setSweepProgress(progress);
              }
            }
          };
          await Promise.all(
            Array.from({ length: Math.min(sweepWorkerCount, items.length) }, () => worker()),
          );
          if (hasFailed) throw firstError;
          points = results.map((result, index) => {
            if (!result) throw new Error(`The sweep response was missing for RF SNR ${items[index].rf_snr_db} dB.`);
            return toSweepPoint(result, items[index].rf_snr_db);
          });
        } else {
          if (!response.ok) throw new ApiHttpError(response.status, batchUrl);
          markProcessing();
          const batchResult = await response.json() as { results: PredictionResponse[] };
          if (!Array.isArray(batchResult.results) || batchResult.results.length !== items.length) {
            throw new Error("The batch prediction response did not contain all sweep results.");
          }
          points = batchResult.results.map((result, index) => toSweepPoint(result, items[index].rf_snr_db));
        }

        cacheRef.current = { ...cacheRef.current, [key]: points };
        setSweepCache(cacheRef.current);
        if (currentKeyRef.current === key) setSweep(points);
        return points;
      } catch (error) {
        if (isCurrent() && !(error instanceof Error && error.name === "AbortError")) {
          const endpoint = error instanceof ApiHttpError || error instanceof ApiTimeoutError
            ? error.url
            : `${API_BASE_URL}/api/${path === "batch" ? "predict-batch" : "predict"}`;
          console.error("Model sweep failed.", { endpoint, inputs: requestInputs, error });
          if (error instanceof ApiTimeoutError) {
            setSweepError(`Timeout: ${error.message}`);
          } else if (error instanceof ApiHttpError) {
            setSweepError(`HTTP status ${error.status} from ${error.url}.`);
          } else if (error instanceof TypeError) {
            setSweepError(`CORS/network failure contacting ${endpoint}. Check the backend URL and allowed frontend origins. (${error.message})`);
          } else {
            setSweepError(error instanceof Error ? error.message : String(error));
          }
        }
        throw error;
      } finally {
        window.clearTimeout(batchTimeout);
        window.clearTimeout(wakeDelay);
        window.clearInterval(wakeClock);
        console.info("Model sweep request finished.", {
          path,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
        if (requestIdRef.current === requestId) {
          setSweeping(false);
          setSweepProgress(null);
          setSweepPhase(null);
          activeRequestRef.current = null;
        }
      }
    })();
    inFlightRef.current.set(key, request);
    try {
      return await request;
    } finally {
      inFlightRef.current.delete(key);
    }
  };

  useEffect(() => {
    if (!apiReady) return;
    const cached = cacheRef.current[currentKey];
    if (cached) {
      setSweep(cached);
      setSweepError(null);
      return;
    }
    setSweep([]);
    setSweepError(null);
    const delay = initialPrefetchRef.current ? 500 : 0;
    initialPrefetchRef.current = true;
    if (activeRequestRef.current && activeRequestRef.current.key !== currentKey) {
      activeRequestRef.current.controller.abort();
    }
    const timer = window.setTimeout(() => {
      void loadSweep(latestInputsRef.current, currentKey).catch(() => {});
    }, delay);
    return () => window.clearTimeout(timer);
  }, [apiReady, currentKey]);

  const runSweep = () => {
    const cached = cacheRef.current[currentKey];
    if (cached) {
      setSweep(cached);
      setSweepError(null);
      return;
    }
    void loadSweep(inputs, currentKey).catch(() => {});
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
              {sweeping
                ? sweepProgress === null ? "Running…" : `Running… ${sweepProgress}/${sweepRange.length}`
                : "Run model sweep"}
            </button>
          </div>
          {sweepPhase === "waking" && (
            <p role="status">Waking up the server… {wakingSeconds} s</p>
          )}
          {sweepPhase === "processing" && (
            <p role="status">Processing results…</p>
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
