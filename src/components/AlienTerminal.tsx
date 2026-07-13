"use client";

import { useEffect, useMemo, useRef } from "react";
import type { UniverseNewsEntry } from "@/lib/db/schema";
import { formatNewsTime } from "@/lib/game/news";

const KIND_PREFIX: Record<string, string> = {
  universe: "NET",
  attack: "CMB",
  guild: "GLD",
  war: "WAR",
  destruction: "XRF",
  contract: "AID",
  ascension: "ASC",
};

type Props = {
  news: UniverseNewsEntry[];
  className?: string;
};

/**
 * Alien computer terminal — scrolling event feed for the Command Center.
 */
export function AlienTerminal({ news, className = "" }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => {
    const base =
      news.length > 0
        ? news
        : ([
            {
              id: "boot",
              at: Date.now(),
              kind: "universe" as const,
              text: "Gate lattice online — awaiting traffic…",
            },
          ] satisfies UniverseNewsEntry[]);
    // Duplicate for seamless scroll when few lines
    if (base.length < 12) {
      return [...base, ...base, ...base];
    }
    return base;
  }, [news]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let raf = 0;
    let y = 0;
    let last = performance.now();
    const speed = 22; // px/sec

    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      y += speed * dt;
      const half = el.scrollHeight / 2;
      if (half > 0 && y >= half) y -= half;
      el.style.transform = `translateY(${-y}px)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lines]);

  return (
    <aside className={`gw-terminal ${className}`.trim()} aria-label="Universe terminal">
      <div className="gw-terminal-bezel">
        <div className="gw-terminal-header">
          <span className="gw-terminal-led" />
          <span>ALIEN NET // UPLINK</span>
          <span className="gw-terminal-hdr-right">SCRL</span>
        </div>
        <div className="gw-terminal-screen">
          <div className="gw-terminal-scan" />
          <div className="gw-terminal-mask">
            <div className="gw-terminal-scroller" ref={scrollerRef}>
              {lines.map((n, i) => (
                <div key={`${n.id}-${i}`} className={`gw-terminal-line kind-${n.kind}`}>
                  <span className="gw-terminal-ts">{formatNewsTime(n.at)}</span>
                  <span className="gw-terminal-tag">
                    [{KIND_PREFIX[n.kind] ?? "SYS"}]
                  </span>
                  <span className="gw-terminal-text">{n.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="gw-terminal-footer">
          LIVE FEED · GUILD / WAR / COMBAT / NET
        </div>
      </div>
    </aside>
  );
}
