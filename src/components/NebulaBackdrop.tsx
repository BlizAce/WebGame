"use client";

import { useEffect, useRef } from "react";
import { createProgram, hexToRgb } from "@/lib/gfx/nebula";
import {
  QUALITY_PRESETS,
  getNebulaColors,
  prefersReducedMotion,
  subscribeNebulaColors,
  type Quality,
} from "@/lib/gfx/nebulaTheme";

type Props = {
  quality: Quality;
};

/** Frame budget. The backdrop is ambience — never let it eat a whole core. */
const TARGET_FPS = 60;
const MIN_FRAME_MS = 1000 / (TARGET_FPS + 5);

/**
 * Full-viewport procedural nebula rendered on the GPU, sitting behind the
 * entire shell so menus, panels and the vector stage all float over live space.
 *
 * Design notes:
 * - Mounts once at the root, so navigating between screens never recreates the
 *   GL context or restarts the animation clock.
 * - Race tint arrives through the nebulaTheme store rather than props/state, so
 *   a colour change costs one uniform upload instead of a React re-render.
 * - Any failure (no WebGL, shader reject) leaves the canvas empty so the CSS
 *   gradient in `globals.css` shows through — graceful by default, never a
 *   black screen and never a thrown error.
 */
export function NebulaBackdrop({ quality }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (quality === "off") return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let gl: WebGLRenderingContext | null;
    try {
      // depth/stencil/antialias off: we draw one fullscreen triangle. alpha off
      // lets the compositor skip blending this layer entirely.
      gl = canvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        powerPreference: "low-power",
      });
    } catch {
      gl = null;
    }
    if (!gl) return; // CSS fallback stays visible — nothing else to do.

    const preset = QUALITY_PRESETS[quality];
    // Freeze the clock for reduced-motion users: they still get the nebula,
    // just a still frame of it.
    const motion = prefersReducedMotion() ? 0 : 1;

    let raf = 0;
    let destroyed = false;
    let paused = false;
    let lastDrawAt = 0;
    // Start at a non-zero phase so the first visible frame already has shape
    // instead of fading up from a flat field.
    const startAt = performance.now() * 0.001 - 12.5;

    let colors = getNebulaColors();

    /**
     * (Re)create GPU resources. Called on mount and again after a context
     * restore, because every program/buffer handle dies with its context —
     * reusing the old ones would silently render nothing.
     */
    const build = () => {
      if (!gl || destroyed) return null;
      const built = createProgram(gl);
      if (!built) return null;
      const { program, uniforms } = built;

      const buffer = gl.createBuffer();
      if (!buffer) {
        gl.deleteProgram(program);
        return null;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      // One triangle covering clip space — cheaper than a quad + index buffer.
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]),
        gl.STATIC_DRAW,
      );
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      gl.useProgram(program);
      gl.uniform1f(uniforms.uOctaves, preset.octaves);
      gl.uniform1f(uniforms.uStarDensity, preset.starDensity);
      gl.uniform1f(uniforms.uMotion, motion);
      // Slightly under 1.0 exposure: panels are translucent, so the field must
      // stay dark enough to keep body text at a comfortable contrast ratio.
      gl.uniform1f(uniforms.uIntensity, quality === "high" ? 1.12 : 1.0);

      return { program, uniforms, buffer };
    };

    let gpu = build();
    if (!gpu) return;

    const uploadColors = () => {
      if (!gl || !gpu) return;
      gl.uniform3fv(gpu.uniforms.uColorA, hexToRgb(colors.glow));
      gl.uniform3fv(gpu.uniforms.uColorB, hexToRgb(colors.primary));
      gl.uniform3fv(gpu.uniforms.uAccent, hexToRgb(colors.accent));
    };
    uploadColors();

    const unsubscribe = subscribeNebulaColors((c) => {
      colors = c;
      uploadColors();
    });

    const resize = () => {
      if (!gl) return;
      const w = wrap.clientWidth || window.innerWidth;
      const h = wrap.clientHeight || window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, preset.maxDpr);
      const bw = Math.max(2, Math.floor(w * dpr * preset.scale));
      const bh = Math.max(2, Math.floor(h * dpr * preset.scale));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
    };

    const paint = () => {
      if (!gl || !gpu) return;
      resize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(gpu.uniforms.uRes, canvas.width, canvas.height);
      gl.uniform1f(gpu.uniforms.uTime, performance.now() * 0.001 - startAt);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const loop = (now: number) => {
      if (destroyed || paused || !gpu) return;
      // Frame cap: leaves headroom for the vector stage and AI sim ticks.
      if (now - lastDrawAt >= MIN_FRAME_MS) {
        lastDrawAt = now;
        paint();
      }
      raf = requestAnimationFrame(loop);
    };

    const startLoop = () => {
      cancelAnimationFrame(raf);
      if (destroyed || paused || motion === 0) return;
      lastDrawAt = 0;
      raf = requestAnimationFrame(loop);
    };

    // First frame (and the only one under reduced motion).
    paint();
    startLoop();

    const ro = new ResizeObserver(() => {
      if (!gl || !gpu) return;
      // Under reduced motion the loop is off, so repaint the still frame after
      // a resize. Safe to reuse paint(): with uMotion == 0 the shader drops all
      // time-varying terms, so any uTime value yields the same image.
      if (motion === 0) paint();
    });
    ro.observe(wrap);

    const onVisibility = () => {
      paused = document.hidden;
      if (!paused) startLoop();
      else cancelAnimationFrame(raf);
    };

    // A lost context is normal on GPU resets / sleep. Rebuild instead of
    // leaving a frozen frame behind.
    const onLost = (e: Event) => {
      e.preventDefault(); // required, or the browser never restores
      gpu = null;
      cancelAnimationFrame(raf);
    };
    const onRestored = () => {
      gpu = build();
      if (!gpu) return;
      uploadColors();
      startLoop();
    };

    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      destroyed = true;
      cancelAnimationFrame(raf);
      unsubscribe();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      if (gpu) {
        gl.deleteProgram(gpu.program);
        if (gpu.buffer) gl.deleteBuffer(gpu.buffer);
      }
      // Ask the driver to release promptly rather than waiting for GC.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [quality]);

  if (quality === "off") return null;

  return (
    <div ref={wrapRef} className="gw-nebula" aria-hidden="true">
      <canvas ref={canvasRef} className="gw-nebula-canvas" />
      {/* Scrim keeps panel/text contrast stable over bright nebula cores. */}
      <div className="gw-nebula-scrim" />
    </div>
  );
}
