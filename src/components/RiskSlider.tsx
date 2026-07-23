import type { CSSProperties, KeyboardEvent } from "react";
import { useI18n } from "../lib/i18n";

export type RiskLevel = "low" | "guarded" | "medium" | "high" | "critical";

type Props = {
  label: string;
  value: number;
  options: number[];
  riskLevel: RiskLevel;
  riskLabel: string;
  onChange: (value: number) => void;
};

type RiskSliderStyle = CSSProperties & {
  "--risk-progress": string;
};

export function RiskSlider({ label, value, options, riskLevel, riskLabel, onChange }: Props) {
  const { t } = useI18n();
  const selectedIndex = Math.max(0, options.indexOf(value));
  const finalIndex = Math.max(1, options.length - 1);
  const progress = (selectedIndex / finalIndex) * 100;
  const style: RiskSliderStyle = { "--risk-progress": `${progress}%` };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    let nextIndex = selectedIndex;

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      nextIndex = Math.max(0, selectedIndex - 1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      nextIndex = Math.min(options.length - 1, selectedIndex + 1);
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = options.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    if (nextIndex !== selectedIndex) {
      onChange(options[nextIndex]);
    }
  };

  return (
    <div className="risk-slider" data-risk={riskLevel} style={style}>
      <div className="risk-slider-values">
        {options.map((option, index) => (
          <button
            key={option}
            type="button"
            className={`risk-slider-value${option === value ? " selected" : ""}`}
            style={{ left: `${(index / finalIndex) * 100}%` }}
            tabIndex={-1}
            aria-label={t("risk.set", { label, value: option })}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>

      <div className="risk-slider-control">
        <input
          className="risk-slider-input"
          type="range"
          min={0}
          max={options.length - 1}
          step={1}
          value={selectedIndex}
          aria-label={label}
          aria-valuemin={options[0]}
          aria-valuemax={options[options.length - 1]}
          aria-valuenow={value}
          aria-valuetext={t("risk.value", { value, risk: riskLabel })}
          data-value={value}
          onChange={(event) => onChange(options[Number(event.target.value)])}
          onKeyDown={handleKeyDown}
        />
        <div className="risk-slider-track" aria-hidden="true">
          <span className="risk-slider-fill" />
          {options.map((option, index) => (
            <i
              key={option}
              className={`${index <= selectedIndex ? "passed" : ""}${index === selectedIndex ? " selected" : ""}`}
              style={{ left: `${(index / finalIndex) * 100}%` }}
            />
          ))}
          <span className="risk-slider-thumb" />
        </div>
      </div>
    </div>
  );
}
