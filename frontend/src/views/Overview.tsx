import { Panel } from "../components/Panel";

export function Overview() {
  return (
    <section className="page-section overview-section" id="overview">
      <h1 className="section-title">Machine Learning-Based Adaptive RF–FSO Switching for Satellite Communication</h1>
      <div className="card-grid overview-cards">
        <Panel title="What was built">
          <p>
            An interactive satellite-link demonstrator pairs orbit geometry with a Radio Frequency (RF) / Free-Space Optical (FSO) model recommendation.
            Four channel inputs help evaluate link performance.
          </p>
        </Panel>
        <Panel title="Accuracy caveat">
          <p>
            Model evaluation uses synthetic scenarios. The reported full-dataset accuracy is not a held-out test
            estimate, and the illustrated link geometry is not live telemetry.
          </p>
        </Panel>
        <Panel title="How to use">
          <p>
            Adjust the channel conditions, inspect the model decision, and use the playback dock or elevation
            timeline to explore the assumed orbit.
          </p>
        </Panel>
      </div>
    </section>
  );
}
