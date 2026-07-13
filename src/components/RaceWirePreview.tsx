"use client";

import { useEffect, useRef } from "react";
import type { RaceId } from "@/lib/db/schema";
import { RACES } from "@/lib/game/races";
import { hexAlpha } from "@/lib/gfx/color";
import {
  project,
  raceWireMesh,
  shipAscensionFx,
  transformPoint,
} from "@/lib/gfx/wireframe";

/** Compact rotating wireframe thumbnail for race selection / profile cards. */
export function RaceWirePreview({
  race,
  active = false,
  size,
  ascensionLevel = 0,
}: {
  race: RaceId;
  active?: boolean;
  /** Optional fixed square size in px (profile thumbnails). */
  size?: number;
  /** Ascension level upgrades the hull silhouette. */
  ascensionLevel?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colors = RACES[race].colors;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let running = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const fx = shipAscensionFx(ascensionLevel);
    const mesh = raceWireMesh(race, ascensionLevel);

    const resize = () => {
      const w = size ?? (canvas.clientWidth || 160);
      const h = size ?? (canvas.clientHeight || 90);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      if (size) {
        canvas.style.width = `${size}px`;
        canvas.style.height = `${size}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const draw = (t: number) => {
      if (!running) return;
      const w = canvas.clientWidth || 160;
      const h = canvas.clientHeight || 90;
      const cx = w * 0.5;
      const cy = h * 0.55;
      const time = t * 0.001;

      ctx.clearRect(0, 0, w, h);

      const bg = ctx.createRadialGradient(
        cx,
        cy,
        2,
        cx,
        cy,
        Math.max(w, h) * 0.75,
      );
      bg.addColorStop(
        0,
        hexAlpha(colors.glow, (active ? 0.34 : 0.14) * fx.glowBoost),
      );
      bg.addColorStop(0.55, hexAlpha(colors.primary, active ? 0.12 : 0.05));
      bg.addColorStop(1, "transparent");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      if (active || fx.corona) {
        ctx.strokeStyle = hexAlpha(
          fx.tier >= 3 ? "#ffe9a0" : colors.accent,
          active ? 0.35 : 0.2,
        );
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(
          cx,
          cy,
          Math.min(w, h) * (0.42 + fx.tier * 0.02),
          Math.min(w, h) * 0.22,
          time * 0.4,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }

      const yaw = time * (active ? 0.95 : 0.48);
      const pitch = 0.35 + Math.sin(time * 0.8) * 0.2;
      const roll = Math.sin(time * 0.5) * 0.1;
      const scale = Math.min(w, h) * 0.0025 * fx.scaleBoost;

      const transformed = mesh.verts.map((p) =>
        transformPoint(p, yaw, pitch, roll, scale, 0, 0, 0),
      );
      const projected = transformed.map((p) => project(p, cx, cy, 140));

      if (mesh.faces?.length) {
        for (const face of mesh.faces) {
          const pts = face.map((i) => projected[i]!).filter((p) => p.visible);
          if (pts.length < 3) continue;
          ctx.beginPath();
          ctx.moveTo(pts[0]!.x, pts[0]!.y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
          ctx.closePath();
          ctx.fillStyle = hexAlpha(colors.glow, active ? 0.1 : 0.05);
          ctx.fill();
        }
      }

      ctx.lineCap = "round";
      for (const [a, b] of mesh.edges) {
        const pa = projected[a]!;
        const pb = projected[b]!;
        if (!pa.visible || !pb.visible) continue;
        ctx.strokeStyle = hexAlpha(colors.glow, active ? 0.32 : 0.2);
        ctx.lineWidth = (active ? 2.8 : 2.2) + fx.tier * 0.15;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
        ctx.strokeStyle = fx.tier >= 3 ? "#ffe9a0" : colors.accent;
        ctx.lineWidth = active ? 1.25 : 1.05;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }

      for (const p of projected) {
        if (!p.visible) continue;
        ctx.fillStyle = hexAlpha(colors.glow, active ? 0.45 : 0.25);
        ctx.beginPath();
        ctx.arc(p.x, p.y, active ? 1.15 : 0.9, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, [race, active, colors, size, ascensionLevel]);

  return <canvas ref={canvasRef} className="gw-race-wire" aria-hidden />;
}
