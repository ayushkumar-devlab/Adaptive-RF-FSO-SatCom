import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Panel } from "../components/Panel";
import type { ApiStatus, ChannelInputs } from "../types";
import {
  createPassSamples,
  createCoverageSummary,
  findPasses,
  getNextPassTime,
  getOrbitMetrics,
  MASK_ELEVATION_DEG,
  SIMULATION_DAY_S,
  type PassWindow,
  type SimClockRef,
} from "../sim/orbit";

const SatelliteScene = lazy(() => import("../SatelliteScene"));
const speedOptions = [0.25, 0.5, 1, 5, 30, 240] as const;
type Speed = typeof speedOptions[number];
type CameraView = "auto" | "manual" | "overview" | "follow" | "ground";
type SceneLinkTruth = {
  visible: boolean;
  elevationDeg: number;
  slantRangeKm: number;
  satelliteId: number;
  inViewCount: number;
};

type SceneErrorBoundaryProps = { children: ReactNode };
type SceneErrorBoundaryState = { hasError: boolean };

class SceneErrorBoundary extends Component<SceneErrorBoundaryProps, SceneErrorBoundaryState> {
  state: SceneErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): SceneErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("The 3D satellite scene failed to render.", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="scene-error" role="alert">
          <p>The 3D scene could not be loaded. Refresh the page to try again.</p>
          <button type="button" onClick={() => window.location.reload()}>Reload page</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function formatSkippedTime(seconds: number) {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min`;
  return `${Math.max(1, Math.round(seconds))} sec`;
}

type LinkSimulationProps = {
  inputs: ChannelInputs;
  prediction: string | null;
  confidence: Record<string, number>;
  apiStatus: ApiStatus;
  predictionError: string | null;
  clockRef: SimClockRef;
  clockTime: number;
  initialPlaying: boolean;
  onClockTick: (time: number) => void;
  onClockSet: (time: number) => void;
  activeSection: string;
  navigation: readonly (readonly [string, string])[];
  onNavigate: (id: string) => void;
  controls: ReactNode;
  onLinkVisibility: (visible: boolean) => void;
};

function PassMarker({
  pass,
  index,
  current,
  onSelect,
}: {
  pass: PassWindow;
  index: number;
  current: boolean;
  onSelect: () => void;
}) {
  const durationMinutes = Math.max(1, Math.round((pass.end - pass.start) / 60));
  return (
    <button
      type="button"
      className={`pass-marker${current ? " current" : ""}`}
      style={{
        left: `${(pass.start / SIMULATION_DAY_S) * 100}%`,
        width: `${Math.max(4, ((pass.end - pass.start) / SIMULATION_DAY_S) * 100)}px`,
        height: `${Math.max(10, Math.min(34, 10 + pass.maxElevation * 0.38))}px`,
      }}
      title={`Pass ${index + 1} · max elevation ${Math.round(pass.maxElevation)}° · about ${durationMinutes} min`}
      aria-label={`Pass ${index + 1}, max elevation ${Math.round(pass.maxElevation)} degrees, about ${durationMinutes} minutes`}
      onClick={onSelect}
    />
  );
}

export function LinkSimulation({
  inputs,
  prediction,
  confidence,
  apiStatus,
  predictionError,
  clockRef,
  clockTime,
  initialPlaying,
  onClockTick,
  onClockSet,
  activeSection,
  navigation,
  onNavigate,
  controls,
  onLinkVisibility,
}: LinkSimulationProps) {
  const [cameraView, setCameraView] = useState<CameraView>("auto");
  const [speed, setSpeed] = useState<Speed>(0.25);
  const [playing, setPlaying] = useState(initialPlaying);
  const [autoSkip, setAutoSkip] = useState(true);
  const [constellationMode, setConstellationMode] = useState(false);
  const [showConstellation, setShowConstellation] = useState(true);
  const [handoverText, setHandoverText] = useState<string | null>(null);
  const [controlsExpanded, setControlsExpanded] = useState(() => {
    try {
      return window.localStorage.getItem("satcom-controls-expanded") === "true";
    } catch {
      return false;
    }
  });
  const [howOpen, setHowOpen] = useState(() => window.innerHeight >= 860);
  const [skipToast, setSkipToast] = useState<string | null>(null);
  const passSamples = useMemo(() => createPassSamples(), []);
  const coverage = useMemo(() => createCoverageSummary(), []);
  const passes = useMemo(() => findPasses(passSamples, MASK_ELEVATION_DEG), [passSamples]);
  const scenePortalRef = useRef<HTMLDivElement>(null!);
  const consoleRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const [consoleInView, setConsoleInView] = useState(true);
  const [stageHeight, setStageHeight] = useState(560);
  const metrics = getOrbitMetrics(clockTime);
  const [linkTruth, setLinkTruth] = useState<SceneLinkTruth>(() => ({
    visible: metrics.elevationDeg >= MASK_ELEVATION_DEG,
    elevationDeg: metrics.elevationDeg,
    slantRangeKm: metrics.slantRangeKm,
    satelliteId: 1,
    inViewCount: 0,
  }));
  const visible = linkTruth.visible;
  const currentPassIndex = passes.findIndex((pass) => clockTime >= pass.start && clockTime <= pass.end);
  const selected = prediction ?? "RF";
  const rfProbability = confidence.RF;
  const fsoProbability = confidence.FSO;
  const theoryEffectiveFso = inputs.fso_snr_db - inputs.atmospheric_loss_db - inputs.cloud_attenuation_db;
  const theorySelection = theoryEffectiveFso > inputs.rf_snr_db ? "FSO" : "RF";

  useEffect(() => {
    if (!skipToast) return;
    const timer = window.setTimeout(() => setSkipToast(null), 2000);
    return () => window.clearTimeout(timer);
  }, [skipToast]);

  useEffect(() => {
    const section = consoleRef.current;
    if (!section) return;
    const observer = new IntersectionObserver(([entry]) => {
      const inView = entry.intersectionRatio >= 0.5;
      setConsoleInView(inView);
      document.body.dataset.stage = inView ? "console" : "reading";
    }, { threshold: [0, 0.5, 1] });
    observer.observe(section);
    return () => {
      observer.disconnect();
      delete document.body.dataset.stage;
    };
  }, []);

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    const updateStageHeight = () => setStageHeight(Math.max(1, window.innerHeight - dock.getBoundingClientRect().height - 16));
    const observer = new ResizeObserver(updateStageHeight);
    observer.observe(dock);
    updateStageHeight();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("satcom-controls-expanded", String(controlsExpanded));
    } catch {
      // Storage can be unavailable in private browsing.
    }
  }, [controlsExpanded]);

  useEffect(() => {
    if (!controlsExpanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setControlsExpanded(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [controlsExpanded]);

  useEffect(() => {
    const handleSpace = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))) return;
      event.preventDefault();
      setPlaying((previous) => {
        clockRef.current.playing = !previous;
        return !previous;
      });
    };
    window.addEventListener("keydown", handleSpace);
    return () => window.removeEventListener("keydown", handleSpace);
  }, [clockRef]);

  const setTime = (time: number) => {
    const normalized = ((time % SIMULATION_DAY_S) + SIMULATION_DAY_S) % SIMULATION_DAY_S;
    clockRef.current.t = normalized;
    onClockSet(normalized);
  };
  const togglePlayback = () => {
    setPlaying((previous) => {
      clockRef.current.playing = !previous;
      return !previous;
    });
  };
  const jumpToPass = () => {
    const upcomingPass = getNextPassTime(clockRef.current.t, passSamples);
    if (upcomingPass === null) return;
    const timeToPass = upcomingPass - clockRef.current.t;
    const lead = clockRef.current.speed * 360;
    if (timeToPass > lead) {
      const destination = upcomingPass - lead;
      const skipped = destination - clockRef.current.t;
      if (skipped > 0) {
        setTime(destination);
        setSkipToast(`Skipped ${formatSkippedTime(skipped)} of simulated time to the next pass`);
      }
    }
    clockRef.current.playing = true;
    setPlaying(true);
  };
  const selectPass = (pass: PassWindow) => setTime(Math.max(0, pass.start - 15));
  const statusText = visible
    ? constellationMode
      ? `${handoverText ?? `Link up · satellite ${linkTruth.satelliteId} · elevation ${Math.round(linkTruth.elevationDeg)}° · ${linkTruth.inViewCount} in view · ${selected} selected`}`
      : `Link up · elevation ${Math.round(linkTruth.elevationDeg)}° · ${selected} selected`
    : constellationMode
      ? "No link: below 10° elevation"
      : "No link: below 10° elevation";

  return (
    <>
      <div className="scene-canvas-layer" aria-hidden="true">
        <div ref={scenePortalRef} className="scene-portal" />
        <SceneErrorBoundary>
          <Suspense fallback={<div className="scene-placeholder" role="status" aria-live="polite">Loading 3D satellite scene…</div>}>
            <SatelliteScene
              selectedLink={selected}
              cloudAttenuationDb={inputs.cloud_attenuation_db}
              cameraView={cameraView}
              htmlPortal={scenePortalRef}
              clockRef={clockRef}
              onClockTick={onClockTick}
              passSamples={passSamples}
              autoSkip={autoSkip}
              onAutoSkip={(seconds) => setSkipToast(`Skipped ${formatSkippedTime(seconds)} of simulated time to the next pass`)}
              constellationMode={constellationMode}
              servingSatelliteId={linkTruth.satelliteId}
              showConstellation={showConstellation}
              isVisible={visible}
              playing={playing}
              controlsEnabled={consoleInView}
              stageHeight={stageHeight}
              onLinkTruth={(truth) => {
                if (constellationMode && truth.satelliteId !== linkTruth.satelliteId) {
                  setHandoverText(`Handover to satellite ${truth.satelliteId}`);
                  window.setTimeout(() => setHandoverText(null), 2000);
                }
                onLinkVisibility(truth.visible);
                setLinkTruth(truth);
              }}
              onCameraManual={() => setCameraView("manual")}
            />
          </Suspense>
        </SceneErrorBoundary>
      </div>
      <section ref={consoleRef} className="console" id="simulator">
        <header className="console-header">
          <h1 className="site-title" title="Machine Learning-Based Adaptive RF–FSO Switching for Satellite Communication">
            <span>ML-Based Adaptive RF–FSO Switching</span>
            <small>for Satellite Communication</small>
          </h1>
          <nav className="pill-nav" aria-label="Page sections">
            {navigation.map(([id, label]) => (
              <button type="button" key={id} className={activeSection === id ? "active" : ""} aria-current={activeSection === id ? "location" : undefined} onClick={() => onNavigate(id)}>
                {label}
              </button>
            ))}
          </nav>
        </header>
        <aside className="console-left">{controls}</aside>
        <div className="console-stage" aria-label="Interactive satellite link scene" />
        <aside className="console-right">
          <Panel title="Model decision" className={`decision-panel${apiStatus === "offline" ? " stale" : ""}`}>
            <p className="decision-sentence">The model picks {selected}.</p>
            <p className="decision-summary">
              {prediction && rfProbability !== undefined && fsoProbability !== undefined
                ? `${rfProbability.toFixed(1)}% probability for RF · ${fsoProbability.toFixed(1)}% for FSO`
                : predictionError ?? "Waiting for the prediction response."}
            </p>
            <p className="decision-summary">Theory check: {theorySelection} (FSO effective {theoryEffectiveFso.toFixed(1)} dB)</p>
            {(["RF", "FSO"] as const).map((link) => {
              const probability = link === "RF" ? rfProbability : fsoProbability;
              const value = link === "RF" ? inputs.rf_snr_db : inputs.fso_snr_db;
              const isRf = link === "RF";
              return (
                <div className={`decision-row ${isRf ? "rf" : "fso"}${selected === link ? " selected" : ""}`} key={link}>
                  <div className="decision-row-heading">
                    <span className="decision-dot" aria-hidden="true" />
                    <strong>{link}</strong>
                    <span className="decision-percent">{probability === undefined ? "—" : `${probability.toFixed(1)}%`}</span>
                  </div>
                  <div className="decision-track"><span style={{ width: `${Math.min(100, Math.max(0, probability ?? 0))}%` }} /></div>
                  <p>{isRf ? `RF SNR ${value} dB (your input)` : `FSO SNR ${value} dB · atmospheric loss ${inputs.atmospheric_loss_db} dB · cloud ${inputs.cloud_attenuation_db} dB (your inputs)`}</p>
                  {selected === link && <small>selected by model</small>}
                </div>
              );
            })}
            {apiStatus === "offline" && <p className="stale-label">last result (stale)</p>}
          </Panel>
          <Panel title="How this simulation works" className="how-panel">
            <details open={howOpen} onToggle={(event) => setHowOpen(event.currentTarget.open)}>
              <summary>How the model and orbit work</summary>
              <div className="how-copy">
              <p>Satellite in view {constellationMode ? coverage.constellationPercent.toFixed(1) : coverage.singlePercent.toFixed(1)}% of the next 24 simulated hours (single satellite: {coverage.singlePercent.toFixed(1)}%, constellation: {coverage.constellationPercent.toFixed(1)}%). Geometry only, not link quality.</p>
              <p>Satellite: a circular low-Earth orbit at 550 km, 53° inclination (assumed). Its position is computed from the simulation clock with standard orbit geometry. It is not a real satellite&apos;s live position.</p>
              <p>Ground station: Bengaluru (12.97°N, 77.59°E), fixed on the rotating Earth.</p>
              <p>Visibility: a link can exist only when the satellite is at least 10° above the station&apos;s horizon. Below that, no link is drawn.</p>
              <p>Why passes are rare: a single satellite takes about 96 minutes per orbit, so the station sees only a few short passes a day. The constellation is an illustrative Walker pattern with handover.</p>
              <p>Link choice: while satellites are in view, the trained Random Forest picks RF or FSO from the four channel values you set. Those values do not change with satellite position.</p>
              <p>When constellation mode is enabled, small dots show the other satellites in the illustrative 144-satellite constellation. The large model is the satellite currently linked.</p>
              <p>Time runs faster than real time (x0.25 to x240 simulated minutes per real second). Illustrative geometry, not to scale, not live telemetry.</p>
              </div>
            </details>
          </Panel>
        </aside>
        <footer ref={dockRef} className="playback-dock">
          <div className="compact-controls">
            <div className="compact-control-row">
              <button type="button" className="playback-round" aria-label={playing ? "Pause simulation" : "Play simulation"} onClick={togglePlayback}>{playing ? "Pause" : "Play"}</button>
              <div className="speed-stepper" role="group" aria-label="Simulation speed">
                <button type="button" aria-label="Previous speed" onClick={() => {
                  const index = speedOptions.indexOf(speed);
                  const next = speedOptions[(index - 1 + speedOptions.length) % speedOptions.length] as Speed;
                  clockRef.current.speed = next;
                  setSpeed(next);
                }}>◀</button>
                <strong>x{speed}</strong>
                <button type="button" aria-label="Next speed" onClick={() => {
                  const index = speedOptions.indexOf(speed);
                  const next = speedOptions[(index + 1) % speedOptions.length] as Speed;
                  clockRef.current.speed = next;
                  setSpeed(next);
                }}>▶</button>
              </div>
            <div className="pass-strip" aria-label="24 hour pass strip">
              {passes.map((pass, index) => <PassMarker key={pass.start} pass={pass} index={index} current={index === currentPassIndex} onSelect={() => selectPass(pass)} />)}
              <input
                className="pass-playhead"
                type="range"
                min={0}
                max={SIMULATION_DAY_S}
                value={clockTime}
                aria-label="Simulation pass position"
                aria-valuetext={currentPassIndex >= 0 ? `Pass ${currentPassIndex + 1} of ${passes.length} in progress` : "Between passes"}
                onChange={(event) => setTime(Number(event.currentTarget.value))}
              />
            </div>
            <button type="button" className="next-pass-button" onClick={jumpToPass}>{constellationMode ? "Next handover" : "Next pass"}</button>
            <button type="button" className="controls-toggle" aria-expanded={controlsExpanded} aria-controls="expanded-controls" onClick={() => setControlsExpanded((expanded) => !expanded)}>Controls <span aria-hidden="true">{controlsExpanded ? "⌃" : "⌄"}</span></button>
            </div>
            <div className="compact-status" role="status" aria-live="polite">{statusText}</div>
          </div>
          {controlsExpanded && <div id="expanded-controls" className="expanded-controls">
            <div className="expanded-group">
            <strong>View</strong>
            <div className="dock-views" role="group" aria-label="Camera views">
              {([
                ["auto", "Auto"],
                ["overview", "Overview"],
                ["follow", "Follow satellite"],
                ["ground", "Ground station"],
              ] as const).map(([view, label]) => (
                <button type="button" key={view} aria-pressed={cameraView === view} className={cameraView === view ? "active" : ""} onClick={() => setCameraView(view)}>{label}</button>
              ))}
            </div>
            </div>
            <div className="expanded-group">
            <strong>Speed</strong>
            <div className="speed-control" role="group" aria-label="Simulation speed">
              {speedOptions.map((speedOption) => (
                <button type="button" key={speedOption} aria-pressed={speedOption === speed} className={speedOption === speed ? "active" : ""} onClick={() => { clockRef.current.speed = speedOption; setSpeed(speedOption); }}>{`x${speedOption}`}</button>
              ))}
            </div>
            <span className="speed-helper">1 s = {speed} min of simulated time</span>
            </div>
            <div className="expanded-group expanded-options">
            <strong>Options</strong>
            <label className="dock-toggle"><input type="checkbox" checked={showConstellation} onChange={(event) => setShowConstellation(event.currentTarget.checked)} />Show constellation</label>
            <label className="skip-toggle"><input type="checkbox" checked={autoSkip} onChange={(event) => setAutoSkip(event.currentTarget.checked)} />Skip to next pass</label>
            </div>
            <div className="expanded-group">
            <strong>Satellites: <button type="button" onClick={() => setConstellationMode(false)} aria-pressed={!constellationMode}>Single</button> | <button type="button" onClick={() => setConstellationMode(true)} aria-pressed={constellationMode}>Constellation</button></strong>
            </div>
          </div>}
          {skipToast && <span className="skip-toast" role="status">{skipToast}</span>}
        </footer>
      </section>
    </>
  );
}
