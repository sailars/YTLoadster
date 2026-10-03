import type { CSSProperties } from "react";

export const noticeDurationMs = 10_000;

const sparks = [
  { x: 8, y: -3, life: 620, delay: -110 },
  { x: 10, y: 2, life: 760, delay: -410 },
  { x: 4, y: -7, life: 580, delay: -290 },
  { x: 7, y: 5, life: 820, delay: -630 },
  { x: 2, y: 6, life: 680, delay: -170 },
  { x: 9, y: -1, life: 540, delay: -440 },
];

export function NoticeCountdown() {
  return (
    <svg
      className="notice-countdown"
      viewBox="0 0 24 24"
      style={{ "--notice-countdown-duration": `${noticeDurationMs}ms` } as CSSProperties}
      aria-hidden="true"
      focusable="false"
    >
      <circle className="notice-countdown-track" cx="12" cy="12" r="8" />
      <circle className="notice-countdown-arc" cx="12" cy="12" r="8" pathLength="100" />
      <g className="notice-countdown-tip">
        <g transform="translate(12 4)">
          <circle className="notice-countdown-ember" r="1.1" />
          {sparks.map((spark, index) => (
            <g
              key={index}
              className="notice-countdown-spark"
              style={{
                "--spark-x": `${spark.x}px`,
                "--spark-y": `${spark.y}px`,
                "--spark-life": `${spark.life}ms`,
                "--spark-delay": `${spark.delay}ms`,
              } as CSSProperties}
            >
              {index % 2 === 0 ? <path d="M-1 0h2" /> : <circle r="0.65" />}
            </g>
          ))}
        </g>
      </g>
    </svg>
  );
}
