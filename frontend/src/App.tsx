import { useEffect, useRef, useState } from "react";
import { ControlPanel } from "./components/ControlPanel";
import { getInitialSimulationTime } from "./sim/orbit";
import { API_BASE_URL, health, predict } from "./api";
import { LinkSimulation } from "./views/LinkSimulation";
import { Method } from "./views/Method";
import { Overview } from "./views/Overview";
import { Results } from "./views/Results";
import type { ApiStatus, ChannelInputs, DecisionState, PredictionResponse } from "./types";
import { theme } from "./theme";

const initialInputs: ChannelInputs = {
  rf_snr_db: 10,
  fso_snr_db: 8,
  atmospheric_loss_db: 2,
  cloud_attenuation_db: 1,
};

const navigation = [
  ["simulator", "Simulation"],
  ["results", "Results"],
  ["overview", "Overview"],
  ["method", "Method"],
] as const;

type HistoryEntry = { inputs: ChannelInputs; response: PredictionResponse };

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function App() {
  const [inputs, setInputs] = useState<ChannelInputs>(initialInputs);
  const [decision, setDecision] = useState<DecisionState>({
    status: "loading",
    rfProb: null,
    fsoProb: null,
    selected: null,
    updatedAt: null,
  });
  const [coldStartSeconds, setColdStartSeconds] = useState(0);
  const [predictionRetryKey, setPredictionRetryKey] = useState(0);
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");
  const [apiHealthReady, setApiHealthReady] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeSection, setActiveSection] = useState("simulator");
  const [clockInitial] = useState(() => ({
    t: getInitialSimulationTime(),
    speed: 100,
    playing: !prefersReducedMotion(),
  }));
  const clockRef = useRef(clockInitial);
  const [, setLinkUp] = useState(false);
  const hasPredictionRef = useRef(false);

  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.board);
    document.title = "Adaptive RF–FSO Switching | Satellite Communication";
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const checkHealth = async () => {
      try {
        await health(controller.signal);
        setApiHealthReady(true);
        setApiStatus("connected");
      } catch (requestError) {
        if (requestError instanceof Error && requestError.name === "AbortError") return;
        setApiStatus("offline");
      }
    };
    void checkHealth();
    const timer = window.setInterval(() => void checkHealth(), 10000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const firstRequest = !hasPredictionRef.current;
    let timer: number | undefined;
    let retryTimer: number | undefined;
    let elapsedTimer: number | undefined;
    let requestStartedAt = 0;
    setDecision((previous) => ({ ...previous, status: "loading" }));
    setApiStatus("loading");

    const requestPrediction = async (attempt: number) => {
      try {
        const timeoutMs = firstRequest && attempt === 0 ? 60_000 : 30_000;
        const response = await predict(inputs, controller.signal, timeoutMs);
        if (controller.signal.aborted) return;
        console.info("Model prediction response.", response);
        const rfProb = response.confidence_percent.RF;
        const fsoProb = response.confidence_percent.FSO;
        if (
          !Number.isFinite(rfProb) ||
          !Number.isFinite(fsoProb) ||
          (response.prediction !== "RF" && response.prediction !== "FSO")
        ) {
          throw new Error("The prediction response did not contain valid link probabilities and selection.");
        }
        hasPredictionRef.current = true;
        if (elapsedTimer !== undefined) window.clearInterval(elapsedTimer);
        setDecision({
          status: "ready",
          rfProb,
          fsoProb,
          selected: response.prediction,
          updatedAt: Date.now(),
        });
        setHistory((previous) => [{ inputs, response }, ...previous].slice(0, 8));
        setApiStatus("connected");
      } catch (requestError) {
        if (controller.signal.aborted || (requestError instanceof Error && requestError.name === "AbortError")) return;
        if (elapsedTimer !== undefined) window.clearInterval(elapsedTimer);
        console.error("Model prediction failed.", {
          endpoint: `${API_BASE_URL}/api/predict`,
          error: requestError,
        });
        setDecision({
          status: "error",
          rfProb: null,
          fsoProb: null,
          selected: null,
          updatedAt: null,
        });
        setApiStatus("offline");
        if (attempt === 0) {
          retryTimer = window.setTimeout(() => {
            if (controller.signal.aborted) return;
            setDecision((previous) => ({ ...previous, status: "loading" }));
            setApiStatus("loading");
            if (firstRequest) {
              requestStartedAt = Date.now();
              elapsedTimer = window.setInterval(
                () => setColdStartSeconds(Math.floor((Date.now() - requestStartedAt) / 1000)),
                1000,
              );
            }
            void requestPrediction(1);
          }, 3000);
        }
      }
    };

    timer = window.setTimeout(() => {
      requestStartedAt = Date.now();
      if (firstRequest) {
        setColdStartSeconds(0);
        elapsedTimer = window.setInterval(
          () => setColdStartSeconds(Math.floor((Date.now() - requestStartedAt) / 1000)),
          1000,
        );
      }
      void requestPrediction(0);
    }, 300);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      if (elapsedTimer !== undefined) window.clearInterval(elapsedTimer);
      controller.abort();
    };
  }, [inputs, predictionRetryKey]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        if (visible) setActiveSection(visible.target.id);
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: [0, 0.15, 0.4] },
    );
    navigation.forEach(([id]) => {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    });
    return () => observer.disconnect();
  }, []);

  const updateInput = (key: keyof ChannelInputs, value: number) => {
    setInputs((previous) => ({ ...previous, [key]: value }));
  };
  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({
      behavior: prefersReducedMotion() ? "instant" : "smooth",
      block: "start",
    });
  };
  return (
    <div className="app-shell">
      <LinkSimulation
        inputs={inputs}
        decision={decision}
        coldStartSeconds={coldStartSeconds}
        onRetryPrediction={() => setPredictionRetryKey((current) => current + 1)}
        clockRef={clockRef}
        initialTime={clockInitial.t}
        initialPlaying={clockInitial.playing}
        activeSection={activeSection}
        navigation={navigation}
        onNavigate={scrollToSection}
        controls={
          <ControlPanel
            inputs={inputs}
            onInputChange={updateInput}
            onReset={() => setInputs(initialInputs)}
          />
        }
        apiStatus={apiStatus}
        onLinkVisibility={setLinkUp}
      />
      <main className="reading-content">
        <Results inputs={inputs} history={history} apiReady={apiHealthReady} />
        <Overview />
        <Method />
        <footer className="page-footer">
          Predictions come from a trained model on supplied inputs. This is a simulation, not live satellite telemetry.
        </footer>
      </main>
    </div>
  );
}
