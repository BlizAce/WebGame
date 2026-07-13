"use client";

import { useEffect, useRef } from "react";
import type { AttackLogEntry, RaceId } from "@/lib/db/schema";
import { RACES } from "@/lib/game/races";
import { formatNaq } from "@/lib/game/economy";
import { hexAlpha } from "@/lib/gfx/color";
import {
  project,
  raceWireMesh,
  transformPoint,
  type Vec3,
} from "@/lib/gfx/wireframe";

export type BattleSceneProps = {
  attackerRace: RaceId;
  defenderRace: RaceId;
  log: AttackLogEntry;
  attackerAscension?: number;
  defenderAscension?: number;
  onDone?: () => void;
};

type Bolt = {
  life: number;
  max: number;
  fromLeft: boolean;
  yOff: number;
  curve: number;
};

type Flash = {
  life: number;
  max: number;
  x: number;
  y: number;
  r: number;
  color: string;
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

/**
 * Full-bleed duel canvas that plays out an attack/raid result:
 * victory → foe hull ruptures; defeat → your fleet is driven back.
 */
export function BattleScene({
  attackerRace,
  defenderRace,
  log,
  attackerAscension = 0,
  defenderAscension = 0,
  onDone,
}: BattleSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const atkColors = RACES[attackerRace].colors;
  const defColors = RACES[defenderRace].colors;
  const won = log.won;
  const kind = log.kind;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let running = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const atkMesh = raceWireMesh(attackerRace, attackerAscension);
    const defMesh = raceWireMesh(defenderRace, defenderAscension);

    const bolts: Bolt[] = [];
    const flashes: Flash[] = [];
    const debris: Debris[] = [];
    let time = 0;
    let phase: "approach" | "exchange" | "climax" | "aftermath" = "approach";
    let phaseT = 0;
    let doneFired = false;

    const resize = () => {
      const parent = canvas.parentElement;
      const w = parent?.clientWidth || 640;
      const h = Math.max(220, Math.min(320, Math.floor(w * 0.42)));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();
    window.addEventListener("resize", resize);

    const spawnBolt = (fromLeft: boolean) => {
      bolts.push({
        life: 0,
        max: 0.35 + Math.random() * 0.25,
        fromLeft,
        yOff: (Math.random() - 0.5) * 40,
        curve: (Math.random() - 0.5) * 30,
      });
    };

    const spawnFlash = (x: number, y: number, color: string, r = 18) => {
      flashes.push({ life: 0, max: 0.45, x, y, r, color });
    };

    const rupture = (cx: number, cy: number) => {
      for (let i = 0; i < 28; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 40 + Math.random() * 120;
        debris.push({
          x: cx,
          y: cy,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 20,
          life: 0,
          max: 0.8 + Math.random() * 0.7,
          rot: Math.random() * Math.PI,
          spin: (Math.random() - 0.5) * 8,
        });
      }
      spawnFlash(cx, cy, won ? defColors.glow : atkColors.glow, 48);
    };

    const drawWire = (
      mesh: ReturnType<typeof raceWireMesh>,
      cx: number,
      cy: number,
      yaw: number,
      pitch: number,
      roll: number,
      scale: number,
      stroke: string,
      glow: string,
      alpha: number,
      shatter = 0,
    ) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = stroke;
      ctx.shadowColor = glow;
      ctx.shadowBlur = 8 + shatter * 20;
      ctx.lineWidth = 1.4;
      ctx.lineCap = "round";
      for (const [ia, ib] of mesh.edges) {
        const va = mesh.verts[ia]!;
        const vb = mesh.verts[ib]!;
        const jitter = (v: Vec3): Vec3 =>
          shatter > 0
            ? [
                v[0] + (Math.random() - 0.5) * shatter * 0.35,
                v[1] + (Math.random() - 0.5) * shatter * 0.35,
                v[2] + (Math.random() - 0.5) * shatter * 0.35,
              ]
            : v;
        const a = project(
          transformPoint(jitter(va), yaw, pitch, roll, 1, 0, 0, 0),
          cx,
          cy,
          scale * 3.2,
        );
        const b = project(
          transformPoint(jitter(vb), yaw, pitch, roll, 1, 0, 0, 0),
          cx,
          cy,
          scale * 3.2,
        );
        if (!a.visible || !b.visible) continue;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.restore();
    };

    let last = performance.now();
    const loop = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      time += dt;
      phaseT += dt;

      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Nebula backdrop
      ctx.fillStyle = "#03050a";
      ctx.fillRect(0, 0, w, h);
      const bg = ctx.createRadialGradient(
        w * 0.5,
        h * 0.45,
        10,
        w * 0.5,
        h * 0.5,
        Math.max(w, h) * 0.7,
      );
      bg.addColorStop(0, hexAlpha(won ? atkColors.glow : "#ff6b55", 0.22));
      bg.addColorStop(0.4, won ? "#0a1520" : "#140a10");
      bg.addColorStop(1, "#04060c");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Parallax stars
      for (let i = 0; i < 55; i++) {
        const z = 0.3 + (i % 5) * 0.12;
        const sx = (i * 97 + time * (8 + z * 14)) % w;
        const sy = (i * 53) % h;
        ctx.fillStyle = `rgba(220,235,255,${0.2 + z * 0.35})`;
        ctx.beginPath();
        ctx.arc(sx, sy, 0.6 + z * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }

      // Floor grid
      const horizon = h * 0.78;
      ctx.strokeStyle = hexAlpha(atkColors.primary, 0.12);
      ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const p = i / 7;
        const y = horizon + Math.pow(p, 1.5) * (h - horizon);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Central gate disc
      const gcx = w * 0.5;
      const gcy = h * 0.48;
      const gr = Math.min(w, h) * 0.16;
      const disc = ctx.createRadialGradient(gcx, gcy, 2, gcx, gcy, gr);
      disc.addColorStop(0, hexAlpha(won ? atkColors.glow : "#ff7050", 0.55));
      disc.addColorStop(0.5, hexAlpha(atkColors.primary, 0.2));
      disc.addColorStop(1, "transparent");
      ctx.fillStyle = disc;
      ctx.beginPath();
      ctx.arc(gcx, gcy, gr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hexAlpha(atkColors.accent, 0.35);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(gcx, gcy, gr * 0.85, time, time + Math.PI * 1.4);
      ctx.stroke();

      // Phase machine
      if (phase === "approach" && phaseT > 0.7) {
        phase = "exchange";
        phaseT = 0;
      } else if (phase === "exchange") {
        if (Math.random() < dt * 8) spawnBolt(true);
        if (Math.random() < dt * 7) spawnBolt(false);
        if (phaseT > 1.4) {
          phase = "climax";
          phaseT = 0;
          const hitX = won ? w * 0.72 : w * 0.28;
          rupture(hitX, h * 0.48);
          for (let i = 0; i < 6; i++) spawnBolt(won);
        }
      } else if (phase === "climax" && phaseT > 0.9) {
        phase = "aftermath";
        phaseT = 0;
      } else if (phase === "aftermath" && phaseT > 1.6 && !doneFired) {
        doneFired = true;
        onDone?.();
      }

      const leftX = w * 0.28;
      const rightX = w * 0.72;
      const midY = h * 0.48;
      const scale = Math.min(w, h) * 0.22;

      const approach = phase === "approach" ? Math.min(1, phaseT / 0.7) : 1;
      const atkYaw = time * 0.7 + (1 - approach) * 1.2;
      const defYaw = -time * 0.65 - (1 - approach) * 1.2;
      const pitch = 0.35;
      const roll = Math.sin(time) * 0.08;

      let atkAlpha = 1;
      let defAlpha = 1;
      let atkShatter = 0;
      let defShatter = 0;
      let atkScale = scale;
      let defScale = scale;

      if (phase === "climax" || phase === "aftermath") {
        if (won) {
          defShatter = Math.min(1.8, phaseT * 2);
          defAlpha = Math.max(0.15, 1 - phaseT * 0.55);
          defScale = scale * (1 + phaseT * 0.15);
          atkScale = scale * (1 + 0.05);
        } else {
          atkShatter = Math.min(1.5, phaseT * 1.8);
          atkAlpha = Math.max(0.2, 1 - phaseT * 0.4);
          atkScale = scale * (1 - phaseT * 0.08);
        }
      }

      // Shield arcs on defender when losing for attacker / winning for them
      if (phase === "exchange" || phase === "climax") {
        const shieldSide = won ? rightX : leftX;
        const shieldColor = won ? defColors.glow : atkColors.glow;
        ctx.strokeStyle = hexAlpha(shieldColor, 0.35 + Math.sin(time * 8) * 0.15);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(shieldSide, midY, scale * 1.15, -0.9, 0.9);
        ctx.stroke();
      }

      drawWire(
        atkMesh,
        leftX - (1 - approach) * 80,
        midY,
        atkYaw,
        pitch,
        roll,
        atkScale,
        atkColors.accent,
        atkColors.glow,
        atkAlpha,
        atkShatter,
      );
      drawWire(
        defMesh,
        rightX + (1 - approach) * 80,
        midY,
        defYaw,
        pitch,
        -roll,
        defScale,
        defColors.accent,
        defColors.glow,
        defAlpha,
        defShatter,
      );

      // Bolts
      for (let i = bolts.length - 1; i >= 0; i--) {
        const b = bolts[i]!;
        b.life += dt;
        const p = b.life / b.max;
        if (p >= 1) {
          bolts.splice(i, 1);
          const hx = b.fromLeft ? rightX - 20 : leftX + 20;
          spawnFlash(
            hx,
            midY + b.yOff,
            b.fromLeft ? atkColors.glow : defColors.glow,
            14,
          );
          continue;
        }
        const x0 = b.fromLeft ? leftX + 30 : rightX - 30;
        const x1 = b.fromLeft ? rightX - 30 : leftX + 30;
        const x = x0 + (x1 - x0) * p;
        const y = midY + b.yOff + Math.sin(p * Math.PI) * b.curve;
        const col = b.fromLeft ? atkColors.glow : defColors.glow;
        ctx.strokeStyle = hexAlpha(col, 0.35);
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(x - (b.fromLeft ? 16 : -16), y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.shadowColor = col;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(x - (b.fromLeft ? 12 : -12), y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i]!;
        f.life += dt;
        const p = f.life / f.max;
        if (p >= 1) {
          flashes.splice(i, 1);
          continue;
        }
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * (1 + p));
        g.addColorStop(0, `rgba(255,240,200,${0.85 * (1 - p)})`);
        g.addColorStop(0.4, hexAlpha(f.color, 0.45 * (1 - p)));
        g.addColorStop(1, "transparent");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r * (1 + p * 1.4), 0, Math.PI * 2);
        ctx.fill();
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
        d.vy += 50 * dt;
        d.rot += d.spin * dt;
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(d.rot);
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = won ? defColors.accent : atkColors.accent;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(-4, -2, 8, 4);
        ctx.restore();
      }

      // Labels
      ctx.fillStyle = hexAlpha(atkColors.glow, 0.7);
      ctx.font = "600 11px ui-monospace, monospace";
      ctx.fillText(log.attackerName, leftX - 40, midY + scale + 28);
      ctx.fillStyle = hexAlpha(defColors.glow, 0.7);
      ctx.fillText(log.defenderName, rightX - 40, midY + scale + 28);

      // Outcome banner
      if (phase === "aftermath" || (phase === "climax" && phaseT > 0.3)) {
        const label = won
          ? kind === "raid"
            ? "RAID SUCCESS"
            : kind === "eradicate"
              ? log.eradicated
                ? "ERADICATED"
                : "ERADICATION FAILED"
              : "VICTORY"
          : kind === "eradicate"
            ? "ERADICATION FAILED"
            : "REPULSED";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(w / 2 - 110, 8, 220, 48);
        ctx.fillStyle = won
          ? hexAlpha(atkColors.glow, 0.95)
          : "rgba(255,120,100,0.95)";
        ctx.font = "700 18px ui-monospace, monospace";
        ctx.shadowColor = won ? atkColors.glow : "#ff7864";
        ctx.shadowBlur = 14;
        ctx.fillText(label, w / 2, 28);
        ctx.shadowBlur = 0;
        ctx.font = "500 12px ui-monospace, monospace";
        ctx.fillStyle = "rgba(230,235,245,0.88)";
        const loot =
          kind === "eradicate" && log.eradicationChance != null
            ? `${Math.round(log.eradicationChance * 100)}% kill roll`
            : won && kind === "attack" && log.naqStolen > 0
              ? `+${formatNaq(log.naqStolen)} Naq`
              : won && kind === "raid" && log.uuStolen > 0
                ? `+${formatNaq(log.uuStolen)} UU`
                : log.summary;
        ctx.fillText(loot, w / 2, 48);
        ctx.textAlign = "left";
      }

      // Vignette
      const vig = ctx.createRadialGradient(
        w * 0.5,
        h * 0.5,
        h * 0.2,
        w * 0.5,
        h * 0.5,
        Math.max(w, h) * 0.65,
      );
      vig.addColorStop(0, "transparent");
      vig.addColorStop(1, "rgba(0,0,0,0.45)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [
    attackerRace,
    defenderRace,
    attackerAscension,
    defenderAscension,
    log,
    onDone,
    won,
    kind,
    atkColors,
    defColors,
  ]);

  return (
    <div className={`gw-battle-scene ${won ? "is-win" : "is-loss"}`}>
      <canvas ref={canvasRef} className="gw-battle-canvas" />
      <div className="gw-battle-caption">
        <span>
          {log.attackerName} → {log.defenderName}
        </span>
        <span>{log.turnsUsed} turns · {kind}</span>
      </div>
    </div>
  );
}

