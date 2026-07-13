"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { GameShell } from "@/components/GameShell";
import { useGame } from "@/lib/game/GameContext";
import type { StageMode } from "@/lib/gfx/stageThemes";

export function PlayGate({
  children,
  stageMode = "command",
}: {
  children: React.ReactNode;
  stageMode?: StageMode;
}) {
  const { player, ready } = useGame();
  const router = useRouter();

  useEffect(() => {
    if (ready && !player) router.replace("/");
  }, [ready, player, router]);

  if (!ready || !player) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--gw-muted)]">
        Opening gate…
      </div>
    );
  }

  return <GameShell stageMode={stageMode}>{children}</GameShell>;
}
