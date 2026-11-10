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
    number: "1",
    title: "BPSK baseline",
    description: "I started with BPSK over a noisy channel. Every later result is compared against it.",
  },
  {
    number: "2",
    title: "RF and FSO links",
    description: "I modelled the radio and optical links separately. RF copes with cloud. FSO carries far more data in clear sky.",
  },
  {
    number: "3",
    title: "Threshold switching",
    description: "My first try: when one link drops below a quality limit, switch to the other. Simple, but a fixed limit can't adapt.",
  },
  {
    number: "4",
    title: "Synthetic dataset",
    description: "I generated 10,000 channel scenarios from four inputs: RF SNR, FSO SNR, atmospheric loss and cloud loss. Each is labelled with the better link.",
  },
  {
    number: "5",
    title: "Random Forest",
    description: "I trained a Random Forest to pick RF or FSO from those four numbers. It scores 99.61% on the full dataset, which is not a held-out test.",
  },
  {
    number: "6",
    title: "Live dashboard",
    description: "FastAPI serves the model. The dashboard sends your slider values to it and shows which link it picks.",
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
          <div className="pipeline-scroll">
            <ol className="pipeline-diagram">
              {stages.map(({ number, title, description }) => (
                  <li
                    className={`pipeline-block${number === "6" ? " pipeline-block-accent" : ""}`}
                    key={number}
                  >
                    <span className="pipeline-number">{number}</span>
                    <strong>{title}</strong>
                    <p>{description}</p>
                  </li>
              ))}
            </ol>
          </div>
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
              <span>Accuracy on all 10,000 synthetic samples I generated</span>
              <small>10,000 samples · 8210 + 1751 correct</small>
            </div>
            <div className="evaluation-stat">
              <strong>97.41%</strong>
              <span>Accuracy on the matched synthetic set</span>
            </div>
            <div className="evaluation-stat">
              <strong>39</strong>
              <span>Misclassified samples</span>
              <small>6 + 33</small>
            </div>
          </div>
          <div className="evaluation-block">
            <h3>Confusion matrix</h3>
            <p className="confusion-caption">I read each row as the actual link and each column as the model&apos;s prediction.</p>
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
            I generated this synthetic data myself. The 99.61% accuracy is
            from all 10,000 samples, and 97.41% is from the matched set.
            Neither score comes from a held-out test split or real link
            measurements. “Matched” means I evaluated each strategy on the
            same 10,000 generated channel scenarios. There were 39 errors
            (6 + 33): 6 RF samples predicted as FSO and 33 FSO samples
            predicted as RF. Those 33 FSO-to-RF mistakes cost more here
            because they leave bandwidth unused.
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
