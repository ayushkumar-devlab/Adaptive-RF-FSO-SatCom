import type { ChannelInputs } from "../types";
import { Panel } from "./Panel";

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
  return (
    <section className="page-section" id="controls">
      <Panel
        title="Channel conditions"
        description="Move a slider and the trained model re-picks the link."
        className="controls-panel"
      >
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
                          onInputChange(key, Math.min(max, Math.max(min, nextValue)));
                        }
                      }}
                    />
                    <span>{unit}</span>
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
                    onInputChange(key, Number(event.currentTarget.value))
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
        <button className="button primary" type="button" onClick={onReset}>
          Reset sliders
        </button>
      </Panel>
    </section>
  );
}
