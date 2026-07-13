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
  type Vec3,
  type WireMesh,
} from "@/lib/gfx/wireframe";
import type { StageMode } from "@/lib/gfx/stageThemes";

type Props = {
  race: RaceId;
  mode?: StageMode;
  intensity?: number;
  /** Player ascension level — upgrades hull silhouette. */
  ascensionLevel?: number;
  className?: string;
};

type Bolt = {
  life: number;
  max: number;
  fromLeft: boolean;
  yOff: number;
  curve: number;
  width: number;
};

type Flash = {
  life: number;
  max: number;
  x: number;
  y: number;
  r: number;
};

type Debris = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  rot: number;
  spin: number;
};

type Shock = {
  life: number;
  max: number;
  x: number;
  y: number;
  r: number;
  color: string;
};

function isBattleMode(mode: StageMode) {
  return (
    mode === "battle" ||
    mode === "planets" ||
    mode === "log" ||
    mode === "war"
  );
}

/**
 * Procedural vector stage: race-tinted nebula, rotating wireframe hulls,
 * battle FX, and per-menu thematic overlays.
 */
export function VectorStage({
  race,
  mode = "command",
  intensity = 1,
  ascensionLevel = 0,
  className = "",
}: Props) {
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
    const foeRace: RaceId =
      race === "asgard"
        ? "goauld"
        : race === "goauld"
          ? "tauri"
          : race === "tauri"
            ? "replicator"
            : "asgard";
    // Foe shows one tier below (or base) so your ascended hull reads as superior
    const foeMesh = raceWireMesh(foeRace, Math.max(0, fx.tier - 1));
    const foeColors = RACES[foeRace].colors;

    const resize = () => {
      const parent = canvas.parentElement;
      const w = parent?.clientWidth || 640;
      const h = parent?.clientHeight || 260;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const starsFar = Array.from({ length: 70 }, () => ({
      x: Math.random(),
      y: Math.random(),
      z: 0.2 + Math.random() * 0.35,
      tw: Math.random() * Math.PI * 2,
    }));
    const starsNear = Array.from({ length: 45 }, () => ({
      x: Math.random(),
      y: Math.random(),
      z: 0.55 + Math.random() * 0.45,
      tw: Math.random() * Math.PI * 2,
    }));
    const dust = Array.from({ length: 28 }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: 0.008 + Math.random() * 0.02,
      s: 0.6 + Math.random() * 1.4,
    }));
    const nebulae = Array.from({ length: 3 }, (_, i) => ({
      x: 0.2 + i * 0.28 + Math.random() * 0.1,
      y: 0.25 + Math.random() * 0.4,
      rx: 0.22 + Math.random() * 0.18,
      ry: 0.12 + Math.random() * 0.1,
      drift: 0.015 + Math.random() * 0.02,
      phase: Math.random() * Math.PI * 2,
    }));

    const shards = Array.from({ length: 12 }, (_, i) => ({
      a: (i / 12) * Math.PI * 2,
      r: 0.55 + (i % 3) * 0.05,
      spin: 0.15 + (i % 4) * 0.05,
    }));

    const bolts: Bolt[] = [];
    const flashes: Flash[] = [];
    const debris: Debris[] = [];
    const shocks: Shock[] = [];
    let nextBoltAt = 0;
    let gatePulse = 0;
    let kawoosh = 0;
    let nextKawoosh = 4 + Math.random() * 6;

    const spawnBolt = (time: number, w: number, h: number) => {
      bolts.push({
        life: 0,
        max: 0.32 + Math.random() * 0.4,
        fromLeft: Math.random() > 0.45,
        yOff: (Math.random() - 0.5) * h * 0.22,
        curve: (Math.random() - 0.5) * 40,
        width: 1.5 + Math.random() * 2.5,
      });
      nextBoltAt = time + 0.16 + Math.random() * 0.32;
    };

    const spawnImpact = (x: number, y: number, color: string) => {
      flashes.push({
        life: 0,
        max: 0.28 + Math.random() * 0.2,
        x,
        y,
        r: 10 + Math.random() * 18,
      });
      shocks.push({
        life: 0,
        max: 0.45,
        x,
        y,
        r: 12 + Math.random() * 10,
        color,
      });
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 40 + Math.random() * 130;
        debris.push({
          x,
          y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: 0,
          max: 0.4 + Math.random() * 0.5,
          rot: Math.random() * Math.PI,
          spin: (Math.random() - 0.5) * 8,
        });
      }
      gatePulse = 1;
    };

    const drawWire = (
      m: WireMesh,
      cx: number,
      cy: number,
      yaw: number,
      pitch: number,
      roll: number,
      scale: number,
      stroke: string,
      glow: string,
      lineW = 1.35,
      showNodes = true,
    ) => {
      const transformed: Vec3[] = m.verts.map((p) =>
        transformPoint(p, yaw, pitch, roll, scale, 0, 0, 0),
      );
      const projected = transformed.map((p) => project(p, cx, cy, 220));

      if (m.faces?.length) {
        for (const face of m.faces) {
          const pts = face
            .map((i) => projected[i]!)
            .filter((p) => p.visible);
          if (pts.length < 3) continue;
          const z = pts.reduce((s, p) => s + p.z, 0) / pts.length;
          const depth = Math.max(0.2, Math.min(1, 1.5 / z));
          ctx.beginPath();
          ctx.moveTo(pts[0]!.x, pts[0]!.y);
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i]!.x, pts[i]!.y);
          }
          ctx.closePath();
          ctx.fillStyle = hexAlpha(glow, 0.06 * depth);
          ctx.fill();
        }
      }

      const edged = m.edges
        .map(([a, b]) => {
          const pa = projected[a]!;
          const pb = projected[b]!;
          return { a: pa, b: pb, z: (pa.z + pb.z) * 0.5 };
        })
        .filter((e) => e.a.visible && e.b.visible)
        .sort((u, v) => v.z - u.z);

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const e of edged) {
        const depth = Math.max(0.25, Math.min(1, 1.6 / e.z));
        ctx.strokeStyle = glow;
        ctx.globalAlpha = 0.28 * depth;
        ctx.lineWidth = lineW + 2.6;
        ctx.beginPath();
        ctx.moveTo(e.a.x, e.a.y);
        ctx.lineTo(e.b.x, e.b.y);
        ctx.stroke();

        ctx.strokeStyle = stroke;
        ctx.globalAlpha = 0.55 + 0.42 * depth;
        ctx.lineWidth = lineW;
        ctx.beginPath();
        ctx.moveTo(e.a.x, e.a.y);
        ctx.lineTo(e.b.x, e.b.y);
        ctx.stroke();
      }

      if (showNodes) {
        for (const p of projected) {
          if (!p.visible) continue;
          const depth = Math.max(0.2, Math.min(1, 1.5 / p.z));
          ctx.fillStyle = hexAlpha(glow, 0.35 * depth);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.1 * depth, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    };

    let lastT = 0;

    const draw = (t: number) => {
      if (!running) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const cx = w * 0.5;
      const cy = h * 0.5;
      const time = t * 0.001;
      const dt = lastT ? Math.min(0.05, (t - lastT) * 0.001) : 0.016;
      lastT = t;
      const battle = isBattleMode(mode);

      // --- deep space base ---
      ctx.fillStyle = "#04060c";
      ctx.fillRect(0, 0, w, h);

      const wash = ctx.createRadialGradient(
        cx,
        cy * 0.85,
        8,
        cx,
        cy,
        Math.max(w, h) * 0.78,
      );
      wash.addColorStop(0, hexAlpha(colors.glow, 0.28 * intensity));
      wash.addColorStop(0.32, hexAlpha(colors.primary, 0.14));
      wash.addColorStop(0.62, colors.secondary);
      wash.addColorStop(1, "#03050a");
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, w, h);

      // drifting nebula clouds
      for (const n of nebulae) {
        const nx = (n.x + Math.sin(time * n.drift + n.phase) * 0.06) * w;
        const ny = (n.y + Math.cos(time * n.drift * 0.7 + n.phase) * 0.04) * h;
        const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, Math.max(w, h) * n.rx);
        g.addColorStop(0, hexAlpha(colors.primary, 0.12 * intensity));
        g.addColorStop(0.45, hexAlpha(colors.glow, 0.05));
        g.addColorStop(1, "transparent");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(nx, ny, w * n.rx, h * n.ry, n.phase * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // aurora bands
      for (let i = 0; i < 5; i++) {
        const y = ((time * 16 + i * 48) % (h + 50)) - 25;
        const g = ctx.createLinearGradient(0, y, w, y + 36);
        g.addColorStop(0, "transparent");
        g.addColorStop(0.5, hexAlpha(colors.accent, 0.035 + (i % 2) * 0.02));
        g.addColorStop(1, "transparent");
        ctx.fillStyle = g;
        ctx.fillRect(0, y, w, 32);
      }

      for (const s of starsFar) {
        const tw = 0.35 + 0.65 * Math.sin(time * 1.4 + s.tw);
        const px = ((s.x + time * 0.004 * s.z) % 1) * w;
        ctx.fillStyle = `rgba(210,225,255,${0.18 * s.z * tw})`;
        ctx.fillRect(px, s.y * h, 1, 1);
      }
      for (const s of starsNear) {
        const tw = 0.4 + 0.6 * Math.sin(time * 2.2 + s.tw);
        const px = ((s.x + time * 0.012 * s.z) % 1) * w;
        ctx.fillStyle = `rgba(230,240,255,${0.3 * s.z * tw})`;
        ctx.beginPath();
        ctx.arc(px, s.y * h, 0.7 + s.z * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const d of dust) {
        const px = ((d.x + time * d.vx) % 1) * w;
        const py = ((d.y + time * d.vx * 0.35) % 1) * h;
        ctx.fillStyle = hexAlpha(colors.accent, 0.12);
        ctx.beginPath();
        ctx.arc(px, py, d.s, 0, Math.PI * 2);
        ctx.fill();
      }

      // perspective grid floor
      const horizon = h * 0.72;
      ctx.save();
      const gridFade = ctx.createLinearGradient(0, horizon, 0, h);
      gridFade.addColorStop(0, hexAlpha(colors.primary, battle ? 0.22 : 0.14));
      gridFade.addColorStop(1, "transparent");
      ctx.strokeStyle = gridFade;
      ctx.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const p = i / 11;
        const y = horizon + Math.pow(p, 1.55) * (h - horizon);
        ctx.globalAlpha = 0.15 + p * 0.55;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      for (let i = -10; i <= 10; i++) {
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(cx + i * 16, horizon);
        ctx.lineTo(cx + i * 95, h);
        ctx.stroke();
      }
      ctx.restore();

      // --- stargate iris ---
      const radius = Math.min(w, h) * (battle ? 0.18 : 0.255);
      const pulse =
        1 +
        Math.sin(time * 2.2) * 0.028 * intensity +
        gatePulse * 0.08 +
        kawoosh * 0.12;
      gatePulse = Math.max(0, gatePulse - dt * 2.2);
      if (time > nextKawoosh && !battle) {
        kawoosh = 1;
        nextKawoosh = time + 5 + Math.random() * 7;
      }
      kawoosh = Math.max(0, kawoosh - dt * 0.85);

      // outer ring body
      ctx.save();
      ctx.translate(cx, cy);
      const ringGrad = ctx.createRadialGradient(0, 0, radius * 0.92, 0, 0, radius * 1.18);
      ringGrad.addColorStop(0, hexAlpha(colors.secondary, 0.9));
      ringGrad.addColorStop(0.55, hexAlpha(colors.primary, 0.35));
      ringGrad.addColorStop(1, "transparent");
      ctx.beginPath();
      ctx.arc(0, 0, radius * 1.12 * pulse, 0, Math.PI * 2);
      ctx.arc(0, 0, radius * 0.88 * pulse, 0, Math.PI * 2, true);
      ctx.fillStyle = ringGrad;
      ctx.fill();

      // rotating chevron ring
      ctx.rotate(time * 0.22);
      for (const sh of shards) {
        const ang = sh.a + time * sh.spin * 0.15;
        ctx.strokeStyle = hexAlpha(colors.accent, 0.55);
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(0, 0, radius * sh.r * pulse, ang, ang + 0.32);
        ctx.stroke();
      }
      ctx.restore();

      // 9 chevrons
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-time * 0.35);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const lit = Math.sin(time * 1.8 + i * 0.7) > 0.35;
        const x1 = Math.cos(a) * radius * 1.02 * pulse;
        const y1 = Math.sin(a) * radius * 1.02 * pulse;
        ctx.fillStyle = lit
          ? hexAlpha(colors.glow, 0.85)
          : hexAlpha(colors.primary, 0.45);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(
          Math.cos(a + 0.11) * radius * 0.9 * pulse,
          Math.sin(a + 0.11) * radius * 0.9 * pulse,
        );
        ctx.lineTo(
          Math.cos(a - 0.11) * radius * 0.9 * pulse,
          Math.sin(a - 0.11) * radius * 0.9 * pulse,
        );
        ctx.closePath();
        ctx.fill();
        if (lit) {
          ctx.shadowColor = colors.glow;
          ctx.shadowBlur = 12;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
      ctx.restore();

      // event horizon
      const disc = ctx.createRadialGradient(
        cx,
        cy,
        radius * 0.05,
        cx,
        cy,
        radius * pulse,
      );
      if (battle) {
        disc.addColorStop(0, hexAlpha("#ff7a55", 0.8));
        disc.addColorStop(0.35, hexAlpha(colors.glow, 0.5));
        disc.addColorStop(0.75, hexAlpha(colors.primary, 0.18));
        disc.addColorStop(1, "transparent");
      } else if (mode === "ascension") {
        disc.addColorStop(0, hexAlpha("#fff6d0", 0.75));
        disc.addColorStop(0.35, hexAlpha(colors.glow, 0.55));
        disc.addColorStop(1, "transparent");
      } else {
        disc.addColorStop(0, hexAlpha("#020810", 0.98));
        disc.addColorStop(0.25, hexAlpha(colors.glow, 0.45 + kawoosh * 0.25));
        disc.addColorStop(0.55, hexAlpha(colors.primary, 0.28));
        disc.addColorStop(0.85, hexAlpha(colors.secondary, 0.35));
        disc.addColorStop(1, "transparent");
      }
      ctx.beginPath();
      ctx.arc(cx, cy, radius * pulse, 0, Math.PI * 2);
      ctx.fillStyle = disc;
      ctx.fill();

      // swirling horizon filaments
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(time * 0.9);
      for (let i = 0; i < 6; i++) {
        const a0 = (i / 6) * Math.PI * 2;
        ctx.strokeStyle = hexAlpha(colors.accent, 0.22 + kawoosh * 0.2);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let s = 0; s < 24; s++) {
          const p = s / 23;
          const ang = a0 + p * 2.2 + Math.sin(time * 3 + s * 0.2) * 0.15;
          const rr = radius * (0.15 + p * 0.78) * pulse;
          const x = Math.cos(ang) * rr;
          const y = Math.sin(ang) * rr * 0.92;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();

      // kawoosh / ripple
      const rip = (time * 0.65) % 1;
      ctx.strokeStyle = hexAlpha(colors.accent, (1 - rip) * 0.5);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * (0.25 + rip * 0.9) * pulse, 0, Math.PI * 2);
      ctx.stroke();
      if (kawoosh > 0.05) {
        ctx.strokeStyle = hexAlpha(colors.glow, kawoosh * 0.7);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, radius * (0.4 + (1 - kawoosh) * 0.9), 0, Math.PI * 2);
        ctx.stroke();
      }

      // --- hulls + theme overlays ---
      const scale = Math.min(w, h) * 0.0012 * fx.scaleBoost;
      const yaw = time * 0.52;
      const pitch = Math.sin(time * 0.7) * 0.32 + 0.22;
      const roll = Math.sin(time * 0.4) * 0.1;
      const hullGlow = hexAlpha(colors.glow, Math.min(1, 0.85 * fx.glowBoost));
      const hullStroke = colors.accent;

      // Ascension corona rings behind the flagship
      if (fx.corona && !battle) {
        for (let i = 0; i < fx.tier; i++) {
          const rr = radius * (1.05 + i * 0.22 + Math.sin(time * 1.4 + i) * 0.03);
          ctx.strokeStyle = hexAlpha(
            fx.tier >= 3 ? "#ffe9a0" : colors.glow,
            0.22 - i * 0.04,
          );
          ctx.lineWidth = 1.4 + fx.tier * 0.2;
          ctx.beginPath();
          ctx.ellipse(
            cx,
            cy,
            rr * 1.55,
            rr * 0.48,
            time * (0.12 + i * 0.04),
            0,
            Math.PI * 2,
          );
          ctx.stroke();
        }
      }

      if (battle) {
        const bob = Math.sin(time * 2.4) * 6;
        const shake =
          gatePulse * Math.sin(time * 48) * 3.5 +
          gatePulse * Math.cos(time * 37) * 2;
        const bScale = Math.min(w, h) * 0.001 * fx.scaleBoost;
        const leftX = w * 0.26 + shake;
        const rightX = w * 0.74 - shake;
        const midY = cy + bob * 0.25;

        // engine glow trails
        for (const side of [
          { x: leftX, c: colors.glow, dir: -1 },
          { x: rightX, c: foeColors.glow, dir: 1 },
        ] as const) {
          const eg = ctx.createRadialGradient(
            side.x + side.dir * 28,
            midY,
            2,
            side.x + side.dir * 28,
            midY,
            36 + fx.tier * 6,
          );
          eg.addColorStop(0, hexAlpha(side.c, 0.45 + fx.tier * 0.06));
          eg.addColorStop(1, "transparent");
          ctx.fillStyle = eg;
          ctx.beginPath();
          ctx.ellipse(side.x + side.dir * 22, midY, 34, 14, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        drawWire(
          mesh,
          leftX,
          midY + bob,
          time * 0.35 + 0.4,
          0.35 + Math.sin(time * 1.2) * 0.15,
          Math.sin(time) * 0.08,
          bScale,
          hullStroke,
          hullGlow,
          1.4 + fx.tier * 0.1,
        );
        drawWire(
          foeMesh,
          rightX,
          midY - bob,
          -time * 0.4 - 0.5,
          0.3 + Math.cos(time * 1.1) * 0.12,
          Math.cos(time * 0.8) * 0.1,
          bScale * 0.95,
          foeColors.accent,
          foeColors.glow,
          1.3,
        );

        if (time > nextBoltAt) spawnBolt(time, w, h);

        for (let i = bolts.length - 1; i >= 0; i--) {
          const b = bolts[i]!;
          b.life += dt;
          const p = Math.min(1, b.life / b.max);
          const x0 = b.fromLeft ? leftX + 30 : rightX - 30;
          const x1 = b.fromLeft ? rightX - 30 : leftX + 30;
          const y0 = midY + b.yOff;
          const y1 = midY - b.yOff * 0.6;
          const x = x0 + (x1 - x0) * p;
          const y = y0 + (y1 - y0) * p + Math.sin(p * Math.PI) * b.curve;
          const col = b.fromLeft ? colors.glow : foeColors.glow;

          ctx.strokeStyle = hexAlpha(col, 0.35 * (1 - p * 0.2));
          ctx.lineWidth = b.width + 4;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.quadraticCurveTo(
            (x0 + x1) * 0.5,
            (y0 + y1) * 0.5 + b.curve,
            x,
            y,
          );
          ctx.stroke();

          ctx.strokeStyle = hexAlpha(col, 0.9);
          ctx.lineWidth = b.width;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.quadraticCurveTo(
            (x0 + x1) * 0.5,
            (y0 + y1) * 0.5 + b.curve,
            x,
            y,
          );
          ctx.stroke();

          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(x, y, 2.4, 0, Math.PI * 2);
          ctx.fill();
          if (p >= 1) {
            spawnImpact(x1, y1, col);
            bolts.splice(i, 1);
          }
        }

        for (let i = flashes.length - 1; i >= 0; i--) {
          const f = flashes[i]!;
          f.life += dt;
          const p = f.life / f.max;
          if (p >= 1) {
            flashes.splice(i, 1);
            continue;
          }
          const g = ctx.createRadialGradient(
            f.x,
            f.y,
            0,
            f.x,
            f.y,
            f.r * (1 + p),
          );
          g.addColorStop(0, `rgba(255,240,200,${0.9 * (1 - p)})`);
          g.addColorStop(0.4, hexAlpha(colors.glow, 0.45 * (1 - p)));
          g.addColorStop(1, "transparent");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r * (1 + p * 1.4), 0, Math.PI * 2);
          ctx.fill();
        }

        for (let i = shocks.length - 1; i >= 0; i--) {
          const s = shocks[i]!;
          s.life += dt;
          const p = s.life / s.max;
          if (p >= 1) {
            shocks.splice(i, 1);
            continue;
          }
          ctx.strokeStyle = hexAlpha(s.color, (1 - p) * 0.7);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * (1 + p * 2.2), 0, Math.PI * 2);
          ctx.stroke();
        }

        for (let i = debris.length - 1; i >= 0; i--) {
          const d = debris[i]!;
          d.life += dt;
          const p = d.life / d.max;
          if (p >= 1) {
            debris.splice(i, 1);
            continue;
          }
          d.x += d.vx * dt;
          d.y += d.vy * dt;
          d.vy += 40 * dt;
          d.rot += d.spin * dt;
          ctx.save();
          ctx.translate(d.x, d.y);
          ctx.rotate(d.rot);
          ctx.globalAlpha = 1 - p;
          ctx.strokeStyle = colors.accent;
          ctx.lineWidth = 1.2;
          ctx.strokeRect(-3, -2, 6, 4);
          ctx.restore();
        }

        ctx.font = "600 10px ui-monospace, monospace";
        ctx.fillStyle = hexAlpha(colors.glow, 0.6);
        ctx.fillText(
          mode === "planets"
            ? "ORBITAL FLEET"
            : mode === "war"
              ? "ALLIED GUILD"
              : "FRIENDLY WIREFRAME",
          leftX - 52,
          midY + 82,
        );
        ctx.fillStyle = hexAlpha(foeColors.glow, 0.6);
        ctx.fillText(
          mode === "planets"
            ? "WORLD DEFENCE"
            : mode === "war"
              ? "ENEMY GUILD"
              : "HOSTILE CONTACT",
          rightX - 46,
          midY + 82,
        );
      } else if (mode === "mothership") {
        drawWire(
          mesh,
          cx,
          cy,
          yaw * 0.7,
          pitch,
          roll,
          scale * 1.4,
          hullStroke,
          hullGlow,
          1.65 + fx.tier * 0.12,
        );
        for (let i = 0; i < 3; i++) {
          const rr = radius * (1.15 + i * 0.28);
          ctx.strokeStyle = hexAlpha(colors.primary, 0.28 - i * 0.06);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rr * 1.45, rr * 0.42, time * 0.18, 0, Math.PI * 2);
          ctx.stroke();
        }
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + time * 0.28;
          ctx.strokeStyle = hexAlpha(colors.glow, 0.4);
          ctx.beginPath();
          ctx.moveTo(
            cx + Math.cos(a) * radius * 0.35,
            cy + Math.sin(a) * radius * 0.18,
          );
          ctx.lineTo(
            cx + Math.cos(a) * radius * 1.75,
            cy + Math.sin(a) * radius * 0.52,
          );
          ctx.stroke();
        }
      } else {
        const themeScale =
          mode === "armory"
            ? 0.85
            : mode === "training"
              ? 0.7
              : mode === "ascension"
                ? 1.12
                : 1;
        drawWire(
          mesh,
          cx + (mode === "bank" ? -w * 0.1 : 0),
          cy - h * 0.015,
          yaw,
          pitch,
          roll,
          scale * themeScale,
          hullStroke,
          hullGlow,
          1.45 + fx.tier * 0.1,
        );

        if (mode === "command" || mode === "settings") {
          for (let i = 0; i < 3; i++) {
            const a = time * 1.05 + (i / 3) * Math.PI * 2;
            drawWire(
              mesh,
              cx + Math.cos(a) * radius * 1.58,
              cy + Math.sin(a * 1.25) * radius * 0.52,
              -yaw * 1.35 + i,
              0.4,
              a,
              scale * 0.26,
              hexAlpha(colors.primary, 0.95),
              colors.glow,
              1,
              false,
            );
          }
        }

        if (mode === "armory") {
          for (let i = 0; i < 8; i++) {
            const a = time * 1.45 + (i / 8) * Math.PI * 2;
            const x = cx + Math.cos(a) * radius * 1.38;
            const y = cy + Math.sin(a) * radius * 0.68;
            ctx.strokeStyle = hexAlpha(colors.accent, 0.75);
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(x - 7, y);
            ctx.lineTo(x + 7, y);
            ctx.moveTo(x, y - 9);
            ctx.lineTo(x, y + 5);
            ctx.stroke();
            ctx.fillStyle = hexAlpha(colors.glow, 0.35);
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        if (mode === "training") {
          for (let i = 0; i < 12; i++) {
            const col = i % 4;
            const row = Math.floor(i / 4);
            const x = cx - 72 + col * 46 + Math.sin(time * 2 + i) * 3;
            const y = cy + 42 + row * 22;
            ctx.strokeStyle = hexAlpha(colors.glow, 0.55);
            ctx.strokeRect(x - 5, y - 8, 10, 16);
            ctx.fillStyle = hexAlpha(colors.glow, 0.12);
            ctx.fillRect(x - 5, y - 8, 10, 16);
          }
        }

        if (mode === "tech") {
          for (let b = 0; b < 5; b++) {
            const bx = cx - 92 + b * 46;
            const by = cy + 52;
            const hgt = 22 + ((Math.sin(time * 2 + b) + 1) * 0.5) * 42;
            ctx.strokeStyle = hexAlpha(colors.accent, 0.65);
            ctx.strokeRect(bx, by - hgt, 18, hgt);
            const bar = ctx.createLinearGradient(bx, by - hgt, bx, by);
            bar.addColorStop(0, hexAlpha(colors.glow, 0.35));
            bar.addColorStop(1, hexAlpha(colors.primary, 0.08));
            ctx.fillStyle = bar;
            ctx.fillRect(bx, by - hgt, 18, hgt);
          }
        }

        if (mode === "bank") {
          ctx.strokeStyle = hexAlpha("#ffb020", 0.6);
          ctx.lineWidth = 1.5;
          for (let i = 0; i < 5; i++) {
            const x = cx + 42 + i * 18;
            const y = cy + Math.sin(time * 3 + i) * 8;
            ctx.strokeRect(x, y - 10, 14, 20);
            ctx.fillStyle = hexAlpha("#ffb020", 0.12);
            ctx.fillRect(x, y - 10, 14, 20);
          }
          ctx.beginPath();
          ctx.arc(cx + w * 0.16, cy, radius * 0.72, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(cx + w * 0.16, cy, radius * 0.45, time, time + Math.PI * 1.2);
          ctx.stroke();
        }

        if (
          mode === "guild" ||
          mode === "contracts" ||
          mode === "market" ||
          mode === "forum" ||
          mode === "mail"
        ) {
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + time * 0.38;
            const x = cx + Math.cos(a) * radius * 1.32;
            const y = cy + Math.sin(a) * radius * 0.68;
            const node = ctx.createRadialGradient(x, y, 0, x, y, 8);
            node.addColorStop(0, hexAlpha(colors.glow, 0.7));
            node.addColorStop(1, "transparent");
            ctx.fillStyle = node;
            ctx.beginPath();
            ctx.arc(x, y, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = hexAlpha(colors.primary, 0.35);
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(x, y);
            ctx.stroke();
          }
        }

        if (mode === "market") {
          ctx.strokeStyle = hexAlpha("#ffb020", 0.5);
          ctx.lineWidth = 1.4;
          for (let i = 0; i < 8; i++) {
            const x = cx - radius * 1.1 + i * (radius * 0.28);
            const hBar = 10 + Math.sin(time * 2.5 + i) * 16;
            ctx.beginPath();
            ctx.moveTo(x, cy + 52);
            ctx.lineTo(x, cy + 52 - hBar);
            ctx.stroke();
          }
        }

        if (mode === "rankings") {
          for (let i = 0; i < 7; i++) {
            const barH = 16 + ((i * 17 + time * 30) % 55);
            const x = cx - 105 + i * 30;
            const bar = ctx.createLinearGradient(x, cy + 62 - barH, x, cy + 62);
            bar.addColorStop(0, hexAlpha(colors.glow, 0.45));
            bar.addColorStop(1, hexAlpha(colors.primary, 0.12));
            ctx.fillStyle = bar;
            ctx.fillRect(x, cy + 62 - barH, 18, barH);
            ctx.strokeStyle = hexAlpha(colors.accent, 0.65);
            ctx.strokeRect(x, cy + 62 - barH, 18, barH);
          }
        }

        if (mode === "ascension") {
          for (let i = 0; i < 4; i++) {
            const ripA = (time * 0.4 + i * 0.25) % 1;
            ctx.strokeStyle = hexAlpha("#ffe9a0", (1 - ripA) * 0.55);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(cx, cy, radius * (0.5 + ripA * 1.45), 0, Math.PI * 2);
            ctx.stroke();
          }
        }

        if (mode === "intel") {
          ctx.setLineDash([4, 6]);
          for (let i = 0; i < 5; i++) {
            const y = cy - 42 + i * 18 + Math.sin(time * 2 + i) * 4;
            ctx.strokeStyle = hexAlpha(colors.accent, 0.38);
            ctx.beginPath();
            ctx.moveTo(cx - 125, y);
            ctx.lineTo(cx + 125, y);
            ctx.stroke();
          }
          ctx.setLineDash([]);
          ctx.fillStyle = hexAlpha(colors.glow, 0.45);
          ctx.font = "600 10px ui-monospace, monospace";
          ctx.fillText("SIGINT · ACTIVE", cx - 42, cy + 72);
        }
      }

      // energy arcs
      ctx.save();
      ctx.translate(cx, cy);
      for (let i = 0; i < (battle ? 7 : 4); i++) {
        const a0 = time * (1.15 + i * 0.1) + i;
        ctx.strokeStyle = hexAlpha(colors.glow, 0.28);
        ctx.lineWidth = 1.35;
        ctx.beginPath();
        for (let s = 0; s < 22; s++) {
          const p = s / 21;
          const ang = a0 + p * 1.85;
          const rr =
            radius * (0.18 + p * 0.92) + Math.sin(time * 6 + s + i) * 7;
          const x = Math.cos(ang) * rr;
          const y = Math.sin(ang) * rr;
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();

      // vignette + soft scanlines + bottom fade
      const vig = ctx.createRadialGradient(
        cx,
        cy,
        h * 0.18,
        cx,
        cy,
        Math.max(w, h) * 0.68,
      );
      vig.addColorStop(0, "transparent");
      vig.addColorStop(1, "rgba(0,0,0,0.58)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      const bottom = ctx.createLinearGradient(0, h * 0.55, 0, h);
      bottom.addColorStop(0, "transparent");
      bottom.addColorStop(1, "rgba(4,8,14,0.55)");
      ctx.fillStyle = bottom;
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = "rgba(0,0,0,0.06)";
      for (let y = 0; y < h; y += 3) {
        ctx.fillRect(0, y, w, 1);
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [race, mode, intensity, colors, ascensionLevel]);

  return (
    <canvas
      ref={canvasRef}
      className={`block h-full w-full ${className}`}
      aria-hidden
    />
  );
}
