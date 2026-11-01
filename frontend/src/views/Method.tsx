import { Panel } from "../components/Panel";
import {
  GROUND_STATION_LAT_DEG,
  GROUND_STATION_LON_DEG,
  MASK_ELEVATION_DEG,
  ORBIT_ALTITUDE_KM,
  ORBIT_INCLINATION_DEG,
} from "../sim/orbit";

const stages = [
  {
    number: "01",
    title: "BPSK baseline",
    description: "Started with the simplest case: BPSK bit error rate over a noisy channel. Every later result is compared against this.",
  },
  {
    number: "02",
    title: "RF and FSO links",
    description: "Modelled the radio link and the optical link separately, then a hybrid of both. RF copes with cloud; FSO carries far more data when the sky is clear.",
  },
  {
    number: "03",
    title: "Threshold switching",
    description: "First attempt at switching: if one link drops below a quality limit, move to the other. Easy to explain, but a fixed limit cannot adapt to changing conditions.",
  },
  {
    number: "04",
    title: "Synthetic dataset",
    description: "Generated 10,000 channel scenarios from four inputs (RF SNR, FSO SNR, atmospheric loss, cloud attenuation), each labelled with the better link.",
  },
  {
    number: "05",
    title: "Random Forest",
    description: "Trained a Random Forest to pick RF or FSO from those four numbers. It scores 99.61% on the full dataset, which is not a held-out test.",
  },
  {
    number: "06",
    title: "Live dashboard",
    description: "FastAPI serves the model. This dashboard sends your slider values to it and shows which link it chooses.",
  },
];

const inputs = [
  "RF SNR",
  "FSO SNR",
  "Atmospheric loss",
  "Cloud attenuation",
];

export function Method() {
  return (
    <section className="page-section method-section" id="method" lang="en">
      <h2 className="section-title">Method</h2>
      <div className="method-stack">
        <Panel title="How I approached the problem">
          <p>
            RF and FSO can help cover each other&apos;s weak points. RF is more
            reliable in cloud and rain, but has lower bandwidth. FSO can carry
            more data, but clouds and atmospheric turbulence can weaken it.
          </p>
          <p>
            I used BPSK bit error rate (BER) to compare link quality. A
            threshold-based rule gives a simple baseline for choosing RF or
            FSO. I also trained a Random Forest classifier to make that choice
            from channel conditions.
          </p>
        </Panel>

        <Panel title="Project pipeline">
          <ol className="pipeline-diagram">
            {stages.map(({ number, title, description }) => (
              <li
                className={`pipeline-block${number === "05" || number === "06" ? " pipeline-block-accent" : ""}`}
                key={number}
              >
                <span className="pipeline-number">{number}</span>
                <strong>{title}</strong>
                <p>{description}</p>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Model inputs and prediction">
          <p>
            The model receives four values: RF SNR, FSO SNR, atmospheric loss,
            and cloud attenuation. The training dataset contains synthetic
            channel scenarios rather than measurements from a real link.
          </p>
          <ul className="compact-list">
            {inputs.map((label) => <li key={label}><span>{label}</span></li>)}
          </ul>
          <p>
            The dashboard sends those values to the FastAPI{" "}
            <code>/api/predict</code> endpoint and displays the returned link
            decision.
          </p>
        </Panel>

        <Panel title="Evaluation">
          <div className="evaluation-stats">
            <div className="evaluation-stat">
              <strong>99.61%</strong>
              <span>Accuracy on the full synthetic dataset</span>
              <small>10,000 samples · 8210 + 1751 correct</small>
            </div>
            <div className="evaluation-stat">
              <strong>97.41%</strong>
              <span>Accuracy on the matched synthetic dataset</span>
            </div>
            <div className="evaluation-stat">
              <strong>39</strong>
              <span>Misclassified samples</span>
              <small>6 + 33</small>
            </div>
          </div>
          <div className="evaluation-block">
            <h3>Confusion matrix</h3>
            <p className="confusion-caption">Rows = true class, columns = predicted class</p>
            <div className="evaluation-table-wrap">
              <table className="confusion-matrix">
                <thead>
                  <tr><th aria-label="true class" /><th>RF</th><th>FSO</th><th>Support</th></tr>
                </thead>
                <tbody>
                  <tr><th>RF</th><td className="matrix-correct">8210</td><td className="matrix-error">6</td><td>8216</td></tr>
                  <tr><th>FSO</th><td className="matrix-error">33</td><td className="matrix-correct">1751</td><td>1784</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <p>
            The Random Forest picks the right link almost every time. The few
            errors are mostly FSO cases predicted as RF. These metrics use the
            full synthetic dataset, so they are not a held-out test or a
            real-link measurement.
          </p>
        </Panel>

        <Panel title="Simulation assumptions">
          <table>
            <tbody>
              <tr><th>Ground station</th><td>Bengaluru ({GROUND_STATION_LAT_DEG} N, {GROUND_STATION_LON_DEG} E)</td></tr>
              <tr><th>Orbit altitude</th><td>{ORBIT_ALTITUDE_KM} km · assumed</td></tr>
              <tr><th>Inclination</th><td>{ORBIT_INCLINATION_DEG} degrees · assumed</td></tr>
              <tr><th>Minimum elevation</th><td>{MASK_ELEVATION_DEG} degrees</td></tr>
              <tr><th>Simulation clock</th><td>×N means N simulated seconds per real second.</td></tr>
            </tbody>
          </table>
          <p>The geometry is illustrative, not a real satellite link.</p>
        </Panel>

        <Panel title="Limitations">
          <p>
            The dataset is synthetic, and accuracy was measured on the full
            dataset rather than a held-out test set. The link models use
            simplified assumptions. This project does not measure a real
            satellite link or establish real-world performance.
          </p>
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
