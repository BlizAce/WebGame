"use client";

/**
 * Renderer settings for the nebula backdrop: race tint + quality tier.
 *
 * Kept outside React state on purpose, following the same module-store shape as
 * `gameClock`: the canvas reads these per drawn frame and pages push into them,
 * so changing the race tint costs one uniform upload instead of re-rendering the
 * game tree. Only components that genuinely need the value subscribe.
 */
import { useCallback, useSyncExternalStore } from "react";

export type NebulaColors = {
  /** Race glow colour (hex) — drives bloom + bright gas. */
  glow: string;
  /** Race primary colour (hex) — drives the main nebula body. */
  primary: string;
  /** Race accent colour (hex) — drives highlights and tinted stars. */
  accent: string;
};

export type Quality = "high" | "low" | "off";

/**
 * GPU cost knobs per tier. `scale` multiplies CSS pixels for the backbuffer,
 * so "low" renders fewer fragments; `octaves` must stay within the shader's
 * fixed fBm loop bound (6). One place owns the perf policy.
 */
export const QUALITY_PRESETS: Record<
  Exclude<Quality, "off">,
  { scale: number; maxDpr: number; octaves: number; starDensity: number }
> = {
  // fBm is ~6 noise taps/pixel at 5 octaves with domain warp — keep the
  // backbuffer near CSS resolution and DPR 1.25 so integrated GPUs stay smooth.
  high: { scale: 1, maxDpr: 1.25, octaves: 5, starDensity: 1 },
  low: { scale: 0.6, maxDpr: 1, octaves: 3, starDensity: 0.55 },
};

const QUALITY_KEY = "gatewars:nebula-quality";

/** Tau'ri blue — the brand default, used before any race is known. */
export const DEFAULT_NEBULA_COLORS: NebulaColors = {
  glow: "#5aa8ff",
  primary: "#3d8bfd",
  accent: "#9ec5ff",
};

// --- colour tint (write-mostly; the canvas subscribes) --------------------

let colors: NebulaColors = { ...DEFAULT_NEBULA_COLORS };
const colorListeners = new Set<(c: NebulaColors) => void>();

/**
 * Update the tint. No-op when nothing changed, so callers can push freely from
 * render or effects without churning subscribers.
 */
export function setNebulaColors(next: NebulaColors): void {
  if (
    next.glow === colors.glow &&
    next.primary === colors.primary &&
    next.accent === colors.accent
  ) {
    return;
  }
  colors = { ...next };
  for (const fn of colorListeners) fn(colors);
}

export function getNebulaColors(): NebulaColors {
  return colors;
}

/** Subscribe to tint changes; returns an unsubscribe function. */
export function subscribeNebulaColors(fn: (c: NebulaColors) => void): () => void {
  colorListeners.add(fn);
  return () => {
    colorListeners.delete(fn);
  };
}

// --- quality tier ---------------------------------------------------------

const isQuality = (v: unknown): v is Quality =>
  v === "high" || v === "low" || v === "off";

/**
 * Read the persisted tier. Absent/invalid storage resolves to `fallback`
 * rather than throwing, so disabled storage or private browsing still renders.
 */
export function readStoredQuality(fallback: Quality = "high"): Quality {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(QUALITY_KEY);
    return isQuality(raw) ? raw : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Resolve the tier to actually run: honour the stored choice, but force a still
 * frame for reduced-motion users by downgrading `high` to `low` (the component
 * additionally freezes time via uMotion).
 */
export function resolveQuality(stored: Quality): Quality {
  if (stored === "off") return "off";
  if (prefersReducedMotion() && stored === "high") return "low";
  return stored;
}

function persistQuality(q: Quality): void {
  try {
    window.localStorage.setItem(QUALITY_KEY, q);
  } catch {
    // Ignore: a session-only quality change is acceptable.
  }
}

/** Server snapshot + first client render must agree, so SSR always says high. */
const SSR_QUALITY: Quality = "high";

let quality: Quality = SSR_QUALITY;
const qualityListeners = new Set<() => void>();

export function getQuality(): Quality {
  return quality;
}

function setQualityInternal(next: Quality): void {
  if (next === quality) return;
  quality = next;
  for (const l of qualityListeners) l();
}

function subscribeQuality(l: () => void): () => void {
  qualityListeners.add(l);
  return () => {
    qualityListeners.delete(l);
  };
}

/**
 * Adopt the stored/reduced-motion-resolved tier after mount. Called once by the
 * backdrop host so hydration never sees a client/server mismatch.
 */
export function hydrateQuality(): void {
  if (typeof window === "undefined") return;
  setQualityInternal(resolveQuality(readStoredQuality(SSR_QUALITY)));
}

/** The effective tier, for non-React callers. */
export function loadQuality(): Quality {
  return quality;
}

export type NebulaQualityApi = {
  /** Effective tier driving the renderer right now. */
  quality: Quality;
  /** Stored preference, which may differ from `quality` under reduced motion. */
  stored: Quality;
  setQuality: (q: Quality) => void;
};

/**
 * Read/write the backdrop quality tier. Persisted to localStorage so the choice
 * survives reloads without touching the exportable game save.
 */
export function useNebulaQuality(): NebulaQualityApi {
  const current = useSyncExternalStore(
    subscribeQuality,
    getQuality,
    () => SSR_QUALITY,
  );

  const setQuality = useCallback((q: Quality) => {
    persistQuality(q);
    // Apply the raw choice immediately; reduced-motion downgrading only happens
    // on load, so an explicit "high" click still means high for this session.
    setQualityInternal(q);
  }, []);

  return { quality: current, stored: readStoredQuality(current), setQuality };
}

/** True when the OS/browser asks for reduced motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
