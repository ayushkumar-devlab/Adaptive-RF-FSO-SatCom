import { useEffect, useRef, useState } from "react";
import { ControlPanel } from "./components/ControlPanel";
import { getInitialSimulationTime } from "./sim/orbit";
import { API_BASE_URL, ApiHttpError, ApiTimeoutError, health, predict } from "./api";
import { LinkSimulation } from "./views/LinkSimulation";
import { Method } from "./views/Method";
import { Overview } from "./views/Overview";
import { Results } from "./views/Results";
import type { ApiStatus, ChannelInputs, PredictionResponse } from "./types";
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
  const [prediction, setPrediction] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<Record<string, number>>({});
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");
  const [apiHealthReady, setApiHealthReady] = useState(false);
  const [predictionError, setPredictionError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeSection, setActiveSection] = useState("simulator");
  const [clockInitial] = useState(() => ({
    t: getInitialSimulationTime(),
    speed: 100,
    playing: !prefersReducedMotion(),
  }));
  const clockRef = useRef(clockInitial);
  const [linkUp, setLinkUp] = useState(false);

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
    if (!linkUp) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPredictionError(null);
      setApiStatus((status) => status === "offline" ? status : "loading");
      try {
        const response = await predict(inputs, controller.signal);
        setPrediction(response.prediction);
        setConfidence(response.confidence_percent);
        setHistory((previous) => [{ inputs, response }, ...previous].slice(0, 8));
        setApiStatus("connected");
      } catch (requestError) {
        if (requestError instanceof Error && requestError.name === "AbortError") return;
        console.error("Model prediction failed.", { endpoint: `${API_BASE_URL}/api/predict`, error: requestError });
        setPredictionError(
          requestError instanceof ApiTimeoutError
            ? "The model service took too long to respond. Please retry."
            : requestError instanceof TypeError
              ? "The model service isn't responding right now. Please try again in a moment."
              : requestError instanceof ApiHttpError
                ? "The model service returned an error. Please try again."
                : "The model service couldn't complete the request. Please try again.",
        );
        setApiStatus("offline");
      }
    }, 1000);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [inputs, linkUp]);

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
        prediction={prediction}
        confidence={confidence}
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
        predictionError={predictionError}
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
