"use client";

import { useMemo } from "react";
import type { MarketCommodity, MarketPriceSnapshot } from "@/lib/db/schema";
import { COMMODITY_LABEL, PRICE_HISTORY_MS } from "@/lib/game/market";
import { formatNaq } from "@/lib/game/economy";

const SERIES: { key: MarketCommodity; color: string }[] = [
  { key: "untrained", color: "#5ec8ff" },
  { key: "attackTurns", color: "#ff9a4a" },
];

type Props = {
  history: MarketPriceSnapshot[];
  height?: number;
};

export function MarketPriceChart({ history, height = 180 }: Props) {
  const now = Date.now();
  const cutoff = now - PRICE_HISTORY_MS;

  const points = useMemo(() => {
    return history
      .filter((s) => s.at >= cutoff)
      .sort((a, b) => a.at - b.at);
  }, [history, cutoff]);

  const { paths, minY, maxY } = useMemo(() => {
    if (points.length < 2) {
      return { paths: [] as { key: MarketCommodity; d: string; color: string }[], minY: 0, maxY: 1 };
    }
    let min = Infinity;
    let max = -Infinity;
    for (const s of points) {
      for (const { key } of SERIES) {
        const v = s.prices[key];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
      min = Math.max(0, min - 1);
      max = min + 2;
    }
    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;

    const w = 100;
    const h = 100;
    const t0 = points[0]!.at;
    const t1 = points[points.length - 1]!.at;
    const span = Math.max(1, t1 - t0);

    const paths = SERIES.map(({ key, color }) => {
      const d = points
        .map((s, i) => {
          const x = ((s.at - t0) / span) * w;
          const y = h - ((s.prices[key] - min) / (max - min)) * h;
          return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(" ");
      return { key, d, color };
    });

    return { paths, minY: min, maxY: max };
  }, [points]);

  const latest = points[points.length - 1];

  return (
    <div className="gw-chart">
      <div className="gw-chart-legend">
        {SERIES.map(({ key, color }) => (
          <span key={key} className="gw-chart-legend-item">
            <i style={{ background: color }} />
            {COMMODITY_LABEL[key]}
            {latest ? (
              <strong style={{ color }}> {formatNaq(latest.prices[key])}</strong>
            ) : null}
          </span>
        ))}
      </div>
      {points.length < 2 ? (
        <p style={{ color: "var(--gw-muted)", fontSize: "0.85rem" }}>
          Collecting price samples — charts fill as the market ticks.
        </p>
      ) : (
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="gw-chart-svg"
          style={{ height }}
          role="img"
          aria-label="Market mid prices over the last 24 hours"
        >
          {[0.25, 0.5, 0.75].map((g) => (
            <line
              key={g}
              x1={0}
              x2={100}
              y1={g * 100}
              y2={g * 100}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={0.4}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {paths.map((p) => (
            <path
              key={p.key}
              d={p.d}
              fill="none"
              stroke={p.color}
              strokeWidth={1.6}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
        </svg>
      )}
      <div className="gw-chart-axis">
        <span>−24h</span>
        <span>
          Mid {formatNaq(minY)} – {formatNaq(maxY)} Naq
        </span>
        <span>now</span>
      </div>
    </div>
  );
}
