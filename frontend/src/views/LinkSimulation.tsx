import { Component, lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ErrorInfo, MutableRefObject, ReactNode } from "react";
import { Panel } from "../components/Panel";
import type { CameraView } from "../SatelliteScene";
import type { ApiStatus, ChannelInputs, DecisionState } from "../types";
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
const speedOptions = [1, 10, 20, 50, 100, 1000] as const;
type Speed = typeof speedOptions[number];
type SceneLinkTruth = {
  visible: boolean;
  elevationDeg: number;
  slantRangeKm: number;
  satelliteId: number;
  inViewCount: number;
};
type LinkTruthHandlerRef = MutableRefObject<(truth: SceneLinkTruth) => void>;

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

const LinkTruthDisplay = memo(function LinkTruthDisplay({
  handlerRef,
  initialTruth,
  constellationMode,
  selected,
  onLinkVisibility,
}: {
  handlerRef: LinkTruthHandlerRef;
  initialTruth: SceneLinkTruth;
  constellationMode: boolean;
  selected: string;
  onLinkVisibility: (visible: boolean) => void;
}) {
  const [truth, setTruth] = useState(initialTruth);
  const lastTruthRef = useRef(initialTruth);
  const lastUpdateRef = useRef(0);

  const updateTruth = useCallback((next: SceneLinkTruth) => {
    const displayed = {
      visible: next.visible,
      elevationDeg: Math.round(next.elevationDeg),
      slantRangeKm: Math.round(next.slantRangeKm),
      satelliteId: next.satelliteId,
      inViewCount: next.inViewCount,
    };
    const previous = lastTruthRef.current;
    if (
      displayed.visible === previous.visible &&
      displayed.elevationDeg === Math.round(previous.elevationDeg) &&
      displayed.slantRangeKm === Math.round(previous.slantRangeKm) &&
      displayed.satelliteId === previous.satelliteId &&
      displayed.inViewCount === previous.inViewCount
    ) return;

    const now = performance.now();
    if (now - lastUpdateRef.current < 250) return;
    lastUpdateRef.current = now;
    lastTruthRef.current = next;
    setTruth(next);
    if (next.visible !== previous.visible) onLinkVisibility(next.visible);
  }, [constellationMode, onLinkVisibility]);

  useEffect(() => {
    handlerRef.current = updateTruth;
    return () => {
      handlerRef.current = () => undefined;
    };
  }, [handlerRef, updateTruth]);

  const statusText = truth.visible
    ? constellationMode
      ? `Link up · satellite ${truth.satelliteId} · elevation ${Math.round(truth.elevationDeg)}° · ${truth.inViewCount} in view · ${selected} selected`
      : `Link up · elevation ${Math.round(truth.elevationDeg)}° · ${selected} selected`
    : "No link: below 10° elevation";
  const inViewDots = Math.max(0, Math.min(144, truth.inViewCount));

  return (
    <div className="compact-status" role="status" aria-live="polite">
      <span>{statusText}</span>
      {constellationMode && (
        <span className="in-view-strip" aria-label={`${inViewDots} satellites above the mask`}>
          {Array.from({ length: inViewDots }, (_, index) => (
            <span
              key={index}
              className={`in-view-dot${index === 0 && truth.visible ? " serving" : ""}`}
              aria-hidden="true"
            />
          ))}
        </span>
      )}
    </div>
  );
});

const PlaybackTimeline = memo(function PlaybackTimeline({
  clockRef,
  initialTime,
  passes,
  onSeek,
  onScrubStart,
  onScrubEnd,
}: {
  clockRef: SimClockRef;
  initialTime: number;
  passes: readonly PassWindow[];
  onSeek: (time: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
}) {
  const [time, setTime] = useState(initialTime);
  const currentPassIndex = passes.findIndex((pass) => time >= pass.start && time <= pass.end);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentTime = clockRef.current.t;
      setTime((previous) => previous === currentTime ? previous : currentTime);
    }, 250);
    return () => window.clearInterval(timer);
  }, [clockRef]);

  const seek = (nextTime: number) => {
    onSeek(nextTime);
    setTime(((nextTime % SIMULATION_DAY_S) + SIMULATION_DAY_S) % SIMULATION_DAY_S);
  };

  return (
    <div className="pass-strip" aria-label="24 hour pass strip">
      {passes.map((pass, index) => (
        <PassMarker
          key={pass.start}
          pass={pass}
          index={index}
          current={index === currentPassIndex}
          onSelect={() => seek(Math.max(0, pass.start - 15))}
        />
      ))}
      <input
        className="pass-playhead"
        type="range"
        min={0}
        max={SIMULATION_DAY_S}
        value={time}
        aria-label="Simulation pass position"
        aria-valuetext={currentPassIndex >= 0 ? `Pass ${currentPassIndex + 1} of ${passes.length} in progress` : "Between passes"}
        onChange={(event) => seek(Number(event.currentTarget.value))}
        onPointerDown={onScrubStart}
        onPointerUp={onScrubEnd}
        onPointerCancel={onScrubEnd}
        onFocus={onScrubStart}
        onBlur={onScrubEnd}
      />
    </div>
  );
});

type LinkSimulationProps = {
  inputs: ChannelInputs;
  decision: DecisionState;
  coldStartSeconds: number;
  onRetryPrediction: () => void;
  apiStatus: ApiStatus;
  clockRef: SimClockRef;
  initialTime: number;
  initialPlaying: boolean;
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

function AnimatedPercent({ value }: { value: number | null }) {
  const [displayed, setDisplayed] = useState(value ?? 0);
  const displayedRef = useRef(value ?? 0);

  useEffect(() => {
    if (value === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      displayedRef.current = value;
      setDisplayed(value);
      return;
    }

    const from = displayedRef.current;
    const startedAt = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 300);
      const next = from + (value - from) * progress;
      displayedRef.current = next;
      setDisplayed(next);
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{value === null ? "—" : `${displayed.toFixed(1)}%`}</>;
}

export function LinkSimulation({
  inputs,
  decision,
  coldStartSeconds,
  onRetryPrediction,
  apiStatus,
  clockRef,
  initialTime,
  initialPlaying,
  activeSection,
  navigation,
  onNavigate,
  controls,
  onLinkVisibility,
}: LinkSimulationProps) {
  const [cameraView, setCameraView] = useState<CameraView>("orbit");
  const [speed, setSpeed] = useState<Speed>(100);
  const [playing, setPlaying] = useState(initialPlaying);
  const [autoSkip, setAutoSkip] = useState(false);
  const [constellationMode, setConstellationMode] = useState(false);
  const [showConstellation, setShowConstellation] = useState(true);
  const orbitTimeRef = useRef(initialTime);
  const wasPlayingBeforeScrubRef = useRef(false);
  const isScrubbingRef = useRef(false);
  const [controlsExpanded, setControlsExpanded] = useState(() => {
    try {
      return window.localStorage.getItem("satcom-controls-expanded") === "true";
    } catch {
      return false;
    }
  });
  const [sidePanelsVisible, setSidePanelsVisible] = useState(() => {
    try {
      return window.localStorage.getItem("satcom-side-panels-visible") !== "false";
    } catch {
      return true;
    }
  });
  const [sidePanelsHidden, setSidePanelsHidden] = useState(() => !sidePanelsVisible);
  const [howOpen, setHowOpen] = useState(() => window.innerHeight >= 860);
  const [skipToast, setSkipToast] = useState<string | null>(null);
  const passSamples = useMemo(() => createPassSamples(), []);
  const coverage = useMemo(() => createCoverageSummary(), []);
  const passes = useMemo(() => findPasses(passSamples, MASK_ELEVATION_DEG), [passSamples]);
  const scenePortalRef = useRef<HTMLDivElement>(null!);
  const consoleRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const [consoleInView, setConsoleInView] = useState(true);
  const [stageHeight, setStageHeight] = useState(560);
  const initialTruth = useMemo<SceneLinkTruth>(() => {
    const metrics = getOrbitMetrics(initialTime);
    return {
    visible: metrics.elevationDeg >= MASK_ELEVATION_DEG,
    elevationDeg: metrics.elevationDeg,
    slantRangeKm: metrics.slantRangeKm,
    satelliteId: 1,
    inViewCount: 0,
    };
  }, [initialTime]);
  const linkTruthRef = useRef(initialTruth);
  const linkTruthHandlerRef = useRef<(truth: SceneLinkTruth) => void>(() => undefined);
  const handleLinkTruth = useCallback((truth: SceneLinkTruth) => {
    linkTruthRef.current = truth;
    linkTruthHandlerRef.current(truth);
  }, []);
  const seekSimulation = useCallback((time: number) => {
    const nextTime = ((time % SIMULATION_DAY_S) + SIMULATION_DAY_S) % SIMULATION_DAY_S;
    clockRef.current.t = nextTime;
    orbitTimeRef.current = nextTime;
  }, [clockRef]);
  const setPlayback = useCallback((nextPlaying: boolean) => {
    clockRef.current.playing = nextPlaying;
    setPlaying(nextPlaying);
  }, [clockRef]);
  const beginScrubbing = useCallback(() => {
    if (isScrubbingRef.current) return;
    isScrubbingRef.current = true;
    wasPlayingBeforeScrubRef.current = clockRef.current.playing;
    setPlayback(false);
  }, [clockRef, setPlayback]);
  const endScrubbing = useCallback(() => {
    if (!isScrubbingRef.current) return;
    isScrubbingRef.current = false;
    if (wasPlayingBeforeScrubRef.current) {
      setPlayback(true);
    }
    wasPlayingBeforeScrubRef.current = false;
  }, [setPlayback]);
  const onAutoSkip = useCallback((seconds: number) => {
    setSkipToast(`Skipped ${formatSkippedTime(seconds)} of simulated time to the next pass`);
  }, []);
  const reportLinkVisibility = useCallback((visible: boolean) => {
    onLinkVisibility(visible);
  }, [onLinkVisibility]);
  const setCameraManual = useCallback(() => setCameraView("manual"), []);
  const selected = decision.selected;
  const sceneSelected = selected ?? "RF";
  const rfProbability = decision.rfProb;
  const fsoProbability = decision.fsoProb;
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
    const stage = stageRef.current;
    if (!stage) return;
    const updateStageHeight = () => setStageHeight(Math.max(1, stage.getBoundingClientRect().height));
    const observer = new ResizeObserver(updateStageHeight);
    observer.observe(stage);
    updateStageHeight();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const updateHeaderH = () => {
      const height = Math.ceil(header.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--header-h", `${height}px`);
    };
    const observer = new ResizeObserver(updateHeaderH);
    observer.observe(header);
    updateHeaderH();
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
    try {
      window.localStorage.setItem("satcom-side-panels-visible", String(sidePanelsVisible));
    } catch {
      // Storage can be unavailable in private browsing.
    }
  }, [sidePanelsVisible]);

  useEffect(() => {
    if (sidePanelsVisible) {
      setSidePanelsHidden(false);
      return;
    }
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200;
    const timer = window.setTimeout(() => setSidePanelsHidden(true), delay);
    return () => window.clearTimeout(timer);
  }, [sidePanelsVisible]);

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
      if (isScrubbingRef.current) return;
      event.preventDefault();
      setPlayback(!clockRef.current.playing);
    };
    window.addEventListener("keydown", handleSpace);
    return () => window.removeEventListener("keydown", handleSpace);
  }, [clockRef, setPlayback]);

  useEffect(() => {
    const handlePanelsShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "h" || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))) return;
      setSidePanelsVisible((visible) => !visible);
    };
    window.addEventListener("keydown", handlePanelsShortcut);
    return () => window.removeEventListener("keydown", handlePanelsShortcut);
  }, []);

  const togglePlayback = () => {
    setPlayback(!clockRef.current.playing);
  };
  const jumpToPass = () => {
    const upcomingPass = getNextPassTime(clockRef.current.t, passSamples);
    if (upcomingPass === null) return;
    const timeToPass = upcomingPass - clockRef.current.t;
    const lead = 20;
    if (timeToPass > lead) {
      const destination = upcomingPass - lead;
      const skipped = destination - clockRef.current.t;
      if (skipped > 0) {
        seekSimulation(destination);
        setSkipToast(`Skipped ${formatSkippedTime(skipped)} of simulated time to the next pass`);
      }
    }
    setPlayback(true);
  };

  return (
    <>
      <section ref={consoleRef} className="console" id="simulator">
        <header ref={headerRef} className="console-header">
          <div className="title-block">
            <h1 className="site-title" title="Machine Learning-Based Adaptive RF–FSO Switching for Satellite Communication">
              <span className="title-line-1">ML-Based Adaptive</span>
              <span className="title-line-2">RF–FSO Switching</span>
              <small>For satellite communication</small>
            </h1>
          </div>
          <nav className="pill-nav" aria-label="Page sections">
            {navigation.map(([id, label]) => (
              <button type="button" key={id} className={activeSection === id ? "active" : ""} aria-current={activeSection === id ? "location" : undefined} onClick={() => onNavigate(id)}>
                {label}
              </button>
            ))}
          </nav>
        </header>
        <aside
          className={`console-left side-panels side-panels-left${sidePanelsVisible ? "" : " is-hiding"}`}
          aria-hidden={sidePanelsHidden}
          inert={!sidePanelsVisible}
        >
          {controls}
        </aside>
        <div ref={stageRef} className="console-stage" aria-label="Interactive satellite link scene">
          <div className="scene-canvas-layer" aria-hidden="true">
            <div ref={scenePortalRef} className="scene-portal" />
            <SceneErrorBoundary>
              <Suspense fallback={<div className="scene-placeholder" role="status" aria-live="polite">Loading 3D satellite scene…</div>}>
                <SatelliteScene
                  selectedLink={sceneSelected}
                  cloudAttenuationDb={inputs.cloud_attenuation_db}
                  cameraView={cameraView}
                  htmlPortal={scenePortalRef}
                  clockRef={clockRef}
                  orbitTimeRef={orbitTimeRef}
                  passSamples={passSamples}
                  autoSkip={autoSkip}
                  onAutoSkip={onAutoSkip}
                  constellationMode={constellationMode}
                  showConstellation={showConstellation}
                  playing={playing}
                  controlsEnabled={consoleInView}
                  stageHeight={stageHeight}
                  onLinkTruth={handleLinkTruth}
                  onCameraManual={setCameraManual}
                />
              </Suspense>
            </SceneErrorBoundary>
          </div>
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
                  <strong>×{speed}</strong>
                  <button type="button" aria-label="Next speed" onClick={() => {
                    const index = speedOptions.indexOf(speed);
                    const next = speedOptions[(index + 1) % speedOptions.length] as Speed;
                    clockRef.current.speed = next;
                    setSpeed(next);
                  }}>▶</button>
                </div>
                <PlaybackTimeline
                  clockRef={clockRef}
                  initialTime={initialTime}
                  passes={passes}
                  onSeek={seekSimulation}
                  onScrubStart={beginScrubbing}
                  onScrubEnd={endScrubbing}
                />
                <button type="button" className="next-pass-button" onClick={jumpToPass}>{constellationMode ? "Next handover" : "Next pass"}</button>
                <button type="button" className="controls-toggle" aria-expanded={controlsExpanded} aria-controls="expanded-controls" onClick={() => setControlsExpanded((expanded) => !expanded)}>Controls <span aria-hidden="true">{controlsExpanded ? "⌃" : "⌄"}</span></button>
              </div>
              <LinkTruthDisplay
                handlerRef={linkTruthHandlerRef}
                initialTruth={initialTruth}
                constellationMode={constellationMode}
                selected={sceneSelected}
                onLinkVisibility={reportLinkVisibility}
              />
            </div>
            {controlsExpanded && <div id="expanded-controls" className="expanded-controls">
              <label className="dock-toggle side-panels-toggle">
                <input type="checkbox" checked={!sidePanelsVisible} onChange={(event) => setSidePanelsVisible(!event.currentTarget.checked)} />
                {sidePanelsVisible ? "Hide side panels" : "Show side panels"}
                <kbd aria-hidden="true">H</kbd>
              </label>
              <div className="expanded-group">
                <strong>View</strong>
                <div className="dock-views" role="group" aria-label="Camera views">
                  {([
                    ["orbit", "Earth fixed"],
                    ["follow", "Follow serving satellite"],
                    ["ground", "Station view"],
                  ] as const).map(([view, label]) => (
                    <button type="button" key={view} aria-label={label} aria-pressed={cameraView === view} className={cameraView === view ? "active" : ""} onClick={() => setCameraView(view)}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="expanded-group">
                <strong>Speed</strong>
                <div className="speed-control" role="group" aria-label="Simulation speed">
                  {speedOptions.map((speedOption) => (
                    <button type="button" key={speedOption} aria-pressed={speedOption === speed} className={speedOption === speed ? "active" : ""} onClick={() => { clockRef.current.speed = speedOption; setSpeed(speedOption); }}>{`×${speedOption}`}</button>
                  ))}
                </div>
                <span className="speed-helper">1 orbit = {Number((5730 / speed).toFixed(1))} s real time</span>
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
        </div>
        <aside
          className={`console-right side-panels side-panels-right${sidePanelsVisible ? "" : " is-hiding"}`}
          aria-hidden={sidePanelsHidden}
          inert={!sidePanelsVisible}
        >
          <Panel title="Model decision" className={`decision-panel${apiStatus === "offline" ? " stale" : ""}`}>
            <p className={`decision-sentence${selected ? ` ${selected === "RF" ? "rf" : "fso"}` : ""}`}>
              {selected && <span className="decision-dot" aria-hidden="true" />}
              Selected link: {selected ?? "—"}
            </p>
            {decision.status === "loading" && (
              <p className="decision-summary" aria-live="polite">
                {decision.updatedAt === null
                  ? `Starting the model service… (${coldStartSeconds} s)`
                  : "Updating…"}
              </p>
            )}
            {decision.status === "ready" && (
              <p className="decision-summary" aria-live="polite">
                Probability RF {rfProbability?.toFixed(1)}%, FSO {fsoProbability?.toFixed(1)}%
              </p>
            )}
            {decision.status === "error" && (
              <div className="decision-summary" role="alert">
                <p>The model service isn&apos;t responding. Showing the rule-based estimate.</p>
                <button type="button" className="button" onClick={onRetryPrediction}>Retry</button>
              </div>
            )}
            <p className="decision-summary">
              {decision.status === "error" ? "Rule-based estimate" : "Rule check"}: {theorySelection} (effective FSO SNR {theoryEffectiveFso.toFixed(1)} dB)
            </p>
            <div className="decision-rows" style={{ opacity: decision.status === "loading" ? 0.6 : 1 }}>
              {(["RF", "FSO"] as const).map((link) => {
                const probability = link === "RF" ? rfProbability : fsoProbability;
                const value = link === "RF" ? inputs.rf_snr_db : inputs.fso_snr_db;
                const isRf = link === "RF";
                return (
                  <div
                    className={`decision-row ${isRf ? "rf" : "fso"}${selected === link ? " selected" : ""}`}
                    key={link}
                    style={{
                      padding: "10px 8px",
                      border: `1px solid ${selected === link ? "var(--border)" : "transparent"}`,
                      borderRadius: 6,
                      backgroundColor: selected === link ? "#1c1f21" : "transparent",
                      transition: "background-color 200ms ease, border-color 200ms ease",
                    }}
                  >
                    <div className="decision-row-heading">
                      <strong>{link}</strong>
                      <span className="decision-percent" style={{ fontVariantNumeric: "tabular-nums" }}>
                        <AnimatedPercent value={probability} />
                      </span>
                    </div>
                    <div className="decision-track">
                      <span
                        style={{
                          display: "block",
                          width: `${Math.min(100, Math.max(0, probability ?? 0))}%`,
                          transition: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                            ? "none"
                            : "width 400ms ease-out",
                        }}
                      />
                    </div>
                    <p>{isRf ? `RF SNR ${value} dB (your input)` : `FSO SNR ${value} dB · atmospheric loss ${inputs.atmospheric_loss_db} dB · cloud ${inputs.cloud_attenuation_db} dB (your inputs)`}</p>
                  </div>
                );
              })}
            </div>
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
              <p>Each speed setting means that many simulated seconds per real second. The geometry is illustrative, not a real satellite link.</p>
              </div>
            </details>
          </Panel>
        </aside>
      </section>
    </>
  );
}
