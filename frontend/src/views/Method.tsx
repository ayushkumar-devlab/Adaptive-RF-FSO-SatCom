import { Panel } from "../components/Panel";
import {
  GROUND_STATION_LAT_DEG,
  GROUND_STATION_LON_DEG,
  MASK_ELEVATION_DEG,
  ORBIT_ALTITUDE_KM,
  ORBIT_INCLINATION_DEG,
} from "../sim/orbit";

const stages = [
  ["Baseline", "step1_bpsk_baseline", "BPSK baseline simulation"],
  ["Link models", "steps2-4_rf_fso_hybrid", "RF, FSO and hybrid link analysis"],
  ["Switching", "step5_threshold_switching", "Threshold-based link switching"],
  ["Dataset and model", "steps6-7_11", "Generate data and train the classifier"],
  ["Evaluation and comparison", "steps8-10_12-16", "Evaluate models and compare strategies"],
];

const inputs = [
  ["RF SNR", "-5 to 30 dB"],
  ["FSO SNR", "-5 to 30 dB"],
  ["Atmospheric loss", "0 to 20 dB"],
  ["Cloud attenuation", "0 to 30 dB"],
];

export function Method() {
  return (
    <section className="page-section method-section" id="method">
      <h2 className="section-title">Method</h2>
      <div className="method-stack">
        <div className="method-workflow" aria-label="Prediction workflow">
          <span>Channel inputs</span><b aria-hidden="true">→</b>
          <span>Random Forest</span><b aria-hidden="true">→</b>
          <span>FastAPI</span><b aria-hidden="true">→</b>
          <span>Link decision</span>
        </div>
        <Panel title="Project pipeline">
          <ol className="pipeline-list">
            {stages.map(([stage, scripts, description], index) => (
              <li key={stage}>
                <strong>{index + 1}. {stage}</strong>
                <span>{description}</span>
                <small>{scripts}</small>
              </li>
            ))}
          </ol>
          <p>Source: project Python scripts.</p>
        </Panel>
        <Panel title="Model">
          <p><strong>Random Forest classifier</strong> outputs RF/FSO probability.</p>
          <ul className="compact-list">{inputs.map(([label, range]) => <li key={label}><span>{label}</span><strong>{range}</strong></li>)}</ul>
          <p>Training data: 10,000 synthetic scenarios. Labels come from a rule-based criterion.</p>
          <p>Source: project Python scripts and ControlPanel.tsx.</p>
        </Panel>
        <Panel title="Evaluation">
          <div className="evaluation-block">
            <h3>Confusion matrix</h3>
            <p>Rows = true RF, FSO · columns = predicted RF, FSO.</p>
            <table>
              <thead><tr><th aria-label="true class" /><th>RF</th><th>FSO</th><th>Support</th></tr></thead>
              <tbody>
                <tr><th>RF</th><td>8210</td><td>6</td><td>8216</td></tr>
                <tr><th>FSO</th><td>33</td><td>1751</td><td>1784</td></tr>
              </tbody>
            </table>
            <p>Step 8 · full dataset · not a held-out test estimate.</p>
          </div>
          <p>97.41% accuracy · matched synthetic dataset · source: README §7.</p>
          <p>99.61% full-dataset accuracy · not a held-out test estimate · source: results/ml_evaluation_metrics.json.</p>
        </Panel>
        <Panel title="Simulation assumptions">
          <table>
            <tbody>
              <tr><th>Ground station</th><td>Bengaluru ({GROUND_STATION_LAT_DEG} N, {GROUND_STATION_LON_DEG} E) · Altitude {ORBIT_ALTITUDE_KM} km · Minimum elevation {MASK_ELEVATION_DEG} degrees: project parameters</td></tr>
              <tr><th>Inclination</th><td>{ORBIT_INCLINATION_DEG} degrees: assumed</td></tr>
              <tr><th>Time scale</th><td>1 s = ×N min of simulated time · presets ×5, ×10, ×15, ×30, ×60, ×240 (default ×60)</td></tr>
            </tbody>
          </table>
          <p>Orbit values are illustrative, not live telemetry.</p>
        </Panel>
        <Panel title="Limitations">
          <ul>
            <li>Results are based on simulated or synthetic link conditions.</li>
            <li>BER comparisons use theoretical estimates derived from link SNR values.</li>
            <li>The results do not establish real-world end-to-end satellite performance.</li>
            <li>The FSO model uses simplified attenuation assumptions.</li>
            <li>Independent test data and more realistic channel models are needed for stronger validation.</li>
          </ul>
          <p>Source: README §8</p>
        </Panel>
        <Panel title="Glossary">
          <dl className="glossary">
            <div><dt>BPSK</dt><dd>Binary phase-shift keying.</dd></div>
            <div><dt>BER</dt><dd>Bit error rate.</dd></div>
            <div><dt>SNR</dt><dd>Signal-to-noise ratio.</dd></div>
            <div><dt>RF</dt><dd>Radio frequency link.</dd></div>
            <div><dt>FSO</dt><dd>Free-space optical link.</dd></div>
            <div><dt>Elevation</dt><dd>Angle above the local horizon.</dd></div>
            <div><dt>Slant range</dt><dd>Distance from station to satellite.</dd></div>
            <div><dt>Mask elevation</dt><dd>Minimum elevation used for visibility.</dd></div>
          </dl>
        </Panel>
      </div>
    </section>
  );
}
