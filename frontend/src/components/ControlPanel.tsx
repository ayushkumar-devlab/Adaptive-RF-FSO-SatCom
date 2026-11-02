import { useState } from "react";
import type { ChannelInputs } from "../types";
import { Panel } from "./Panel";

const scenarios = {
  clearSky: {
    rf_snr_db: 5,
    fso_snr_db: 25,
    atmospheric_loss_db: 2,
    cloud_attenuation_db: 1,
  },
  cloudy: {
    rf_snr_db: 20,
    fso_snr_db: 12,
    atmospheric_loss_db: 6,
    cloud_attenuation_db: 8,
  },
} satisfies Record<string, ChannelInputs>;

const controls = [
  {
    key: "rf_snr_db",
    label: "RF signal-to-noise ratio",
    unit: "dB",
    min: -5,
    max: 30,
  },
  {
    key: "fso_snr_db",
    label: "FSO signal-to-noise ratio",
    unit: "dB",
    min: -5,
    max: 30,
  },
  {
    key: "atmospheric_loss_db",
    label: "Atmospheric loss",
    unit: "dB",
    min: 0,
    max: 20,
  },
  {
    key: "cloud_attenuation_db",
    label: "Cloud attenuation",
    unit: "dB",
    min: 0,
    max: 30,
  },
] as const;

type ControlPanelProps = {
  inputs: ChannelInputs;
  onInputChange: (key: keyof ChannelInputs, value: number) => void;
  onReset: () => void;
};

export function ControlPanel({
  inputs,
  onInputChange,
  onReset,
}: ControlPanelProps) {
  const [activeScenario, setActiveScenario] = useState<keyof typeof scenarios | null>(null);

  const applyScenario = (scenario: keyof typeof scenarios) => {
    setActiveScenario(scenario);
    const values = scenarios[scenario];
    onInputChange("rf_snr_db", values.rf_snr_db);
    onInputChange("fso_snr_db", values.fso_snr_db);
    onInputChange("atmospheric_loss_db", values.atmospheric_loss_db);
    onInputChange("cloud_attenuation_db", values.cloud_attenuation_db);
  };

  const handleInputChange = (key: keyof ChannelInputs, value: number) => {
    setActiveScenario(null);
    onInputChange(key, value);
  };

  const reset = () => {
    setActiveScenario(null);
    onReset();
  };

  return (
    <section className="page-section" id="controls">
      <Panel
        title="Channel conditions"
        description="Move a slider and the trained model re-picks the link."
        className="controls-panel"
      >
        <div className="scenario-options">
          <div className="scenario-actions" role="group" aria-label="Scenario presets">
            <button
              className={`scenario-btn scenario-clear${activeScenario === "clearSky" ? " scenario-selected" : ""}`}
              type="button"
              aria-pressed={activeScenario === "clearSky"}
              onClick={() => applyScenario("clearSky")}
            >
              Clear sky
            </button>
            <button
              className={`scenario-btn scenario-cloudy${activeScenario === "cloudy" ? " scenario-selected" : ""}`}
              type="button"
              aria-pressed={activeScenario === "cloudy"}
              onClick={() => applyScenario("cloudy")}
            >
              Cloudy
            </button>
          </div>
          <p className="scenario-hint">
            The model picks FSO when its SNR, after the atmospheric and cloud losses, still beats the RF SNR. Otherwise, RF.
          </p>
        </div>
        <div className="controls-list">
          {controls.map(({ key, label, unit, min, max }) => {
            const value = inputs[key];
            const fill = ((value - min) / (max - min)) * 100;
            return (
              <div className="control-item" key={key}>
                <div className="control-label">
                  <label htmlFor={key}>{label}</label>
                  <div className="control-input-value">
                    <input
                      id={`${key}-number`}
                      className="number-input"
                      type="number"
                      min={min}
                      max={max}
                      step={1}
                      value={value}
                      aria-label={`${label} value in ${unit}`}
                      onChange={(event) => {
                        const nextValue = Number(event.currentTarget.value);
                        if (Number.isFinite(nextValue)) {
                          handleInputChange(key, Math.min(max, Math.max(min, nextValue)));
                        }
                      }}
                    />
                    <span className="control-unit">{unit}</span>
                  </div>
                </div>
                <input
                  id={key}
                  className={`channel-slider ${key}`}
                  type="range"
                  min={min}
                  max={max}
                  step={1}
                  value={value}
                  style={{ background: `linear-gradient(to right, var(--slider-fill) ${fill}%, var(--range-track) ${fill}%)` }}
                  aria-valuetext={`${value} ${unit}`}
                  onChange={(event) =>
                    handleInputChange(key, Number(event.currentTarget.value))
                  }
                />
                <div className="range-labels">
                  <span>{min} {unit}</span>
                  <span>{max} {unit}</span>
                </div>
              </div>
            );
          })}
        </div>
        <button className="button primary" type="button" onClick={reset}>
          Reset sliders
        </button>
      </Panel>
    </section>
  );
}
