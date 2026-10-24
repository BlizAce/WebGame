"use client";

/**
 * Mounts the site-wide nebula backdrop exactly once, below every route.
 *
 * Responsibilities kept thin on purpose:
 *  - adopt the stored / reduced-motion-resolved quality tier after hydration;
 *  - push the in-game race tint into the colour store so the field matches the
 *    commander you picked;
 *  - leave the tint alone when there is no player, so the landing page can own
 *    it while the visitor previews races.
 */
import { useEffect } from "react";
import { useGame } from "@/lib/game/GameContext";
import { RACES } from "@/lib/game/races";
import { NebulaBackdrop } from "@/components/NebulaBackdrop";
import { hydrateQuality, setNebulaColors, useNebulaQuality } from "@/lib/gfx/nebulaTheme";

export function NebulaLayer() {
  const { quality } = useNebulaQuality();
  const { player, ready } = useGame();

  // Read localStorage only after mount — the SSR snapshot is a fixed default so
  // hydration stays consistent.
  useEffect(() => {
    hydrateQuality();
  }, []);

  useEffect(() => {
    if (!ready || !player) return;
    const c = RACES[player.race].colors;
    setNebulaColors({ glow: c.glow, primary: c.primary, accent: c.accent });
  }, [ready, player]);

  return <NebulaBackdrop quality={quality} />;
}
