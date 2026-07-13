"use client";

import { useEffect, useRef } from "react";
import { hexAlpha } from "@/lib/gfx/color";

type Pt = { x: number; y: number };

type Bolt = {
  life: number;
  max: number;
  main: Pt[];
  branches: Pt[][];
};

type Props = {
  ascensionLevel: number;
  glow: string;
  accent: string;
};

/** Midpoint-displacement polyline for a jagged bolt. */
function displace(a: Pt, b: Pt, displaceAmt: number, depth: number): Pt[] {
  if (depth <= 0 || displaceAmt < 0.6) return [a, b];
  const mx = (a.x + b.x) * 0.5 + (Math.random() - 0.5) * displaceAmt;
  const my = (a.y + b.y) * 0.5 + (Math.random() - 0.5) * displaceAmt * 0.65;
  const mid = { x: mx, y: my };
  const left = displace(a, mid, displaceAmt * 0.52, depth - 1);
  const right = displace(mid, b, displaceAmt * 0.52, depth - 1);
  return [...left.slice(0, -1), ...right];
}

function makeBolt(w: number, h: number): Omit<Bolt, "life" | "max"> {
  const fromLeft = Math.random() > 0.5;
  const start: Pt = {
    x: fromLeft ? -4 : w + 4,
    y: h * (0.05 + Math.random() * 0.35),
  };
  const end: Pt = {
    x: fromLeft ? w * (0.45 + Math.random() * 0.5) : w * Math.random() * 0.55,
    y: h * (0.35 + Math.random() * 0.55),
  };
  const span = Math.hypot(end.x - start.x, end.y - start.y);
  const main = displace(start, end, span * 0.22, 5);

  const branches: Pt[][] = [];
  const branchChance = 0.22;
  for (let i = 3; i < main.length - 3; i++) {
    if (Math.random() > branchChance) continue;
    const p = main[i]!;
    const len = 28 + Math.random() * 55;
    const ang =
      Math.atan2(end.y - start.y, end.x - start.x) +
      (Math.random() > 0.5 ? 1 : -1) * (0.6 + Math.random() * 0.9);
    const tip = {
      x: p.x + Math.cos(ang) * len,
      y: p.y + Math.sin(ang) * len,
    };
    branches.push(displace(p, tip, len * 0.28, 3));
  }

  return { main, branches };
}

function strokePath(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  color: string,
  width: number,
  blur: number,
) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.stroke();
}

/**
 * Stage-scoped lightning for ascended commanders.
 * Lives inside `.gw-stage` only — never covers nav/panel or steals clicks.
 */
export function AscensionLightning({
  ascensionLevel,
  glow,
  accent,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const active = ascensionLevel > 0;

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let raf = 0;
    let running = true;
    const bolts: Bolt[] = [];
    let nextAt = 1.2 + Math.random() * 2;
    let lastT = 0;
    const tier = Math.min(4, Math.max(1, Math.floor(ascensionLevel)));
    const boltGlow = tier >= 3 ? "#ffe6a8" : glow;
    const boltCore = tier >= 3 ? "#fffdf5" : accent;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w < 2 || h < 2) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const draw = (t: number) => {
      if (!running) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w < 2 || h < 2) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const time = t * 0.001;
      const dt = lastT ? Math.min(0.05, (t - lastT) * 0.001) : 0.016;
      lastT = t;

      // Full clear — keep buffer truly transparent
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      if (time >= nextAt) {
        bolts.push({
          ...makeBolt(w, h),
          life: 0,
          max: 0.14 + Math.random() * 0.12,
        });
        if (Math.random() < 0.25 + tier * 0.05) {
          bolts.push({
            ...makeBolt(w, h),
            life: 0,
            max: 0.1 + Math.random() * 0.08,
          });
        }
        nextAt = time + Math.max(1.4, 3.6 - tier * 0.35 + Math.random() * 2.8);
      }

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = "lighter";

      for (let i = bolts.length - 1; i >= 0; i--) {
        const b = bolts[i]!;
        b.life += dt;
        const p = b.life / b.max;
        if (p >= 1) {
          bolts.splice(i, 1);
          continue;
        }
        // Fast attack, soft decay
        const bright =
          p < 0.08 ? p / 0.08 : Math.pow(Math.max(0, 1 - (p - 0.08) / 0.92), 1.6);
        const a = bright * (0.55 + tier * 0.06);

        // Outer glow → mid → hot core
        strokePath(ctx, b.main, hexAlpha(boltGlow, a * 0.25), 7.5, 18);
        strokePath(ctx, b.main, hexAlpha(boltGlow, a * 0.55), 3.2, 10);
        strokePath(ctx, b.main, hexAlpha(boltCore, a * 0.95), 1.15, 4);
        strokePath(ctx, b.main, hexAlpha("#ffffff", a * 0.7), 0.55, 0);

        for (const br of b.branches) {
          strokePath(ctx, br, hexAlpha(boltGlow, a * 0.35), 2.2, 8);
          strokePath(ctx, br, hexAlpha(boltCore, a * 0.75), 0.8, 2);
        }
      }

      ctx.globalCompositeOperation = "source-over";
      ctx.shadowBlur = 0;
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [active, ascensionLevel, glow, accent]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className="gw-ascension-lightning"
      aria-hidden
      style={{ pointerEvents: "none" }}
    />
  );
}
