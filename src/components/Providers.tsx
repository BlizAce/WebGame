"use client";

import { GameProvider } from "@/lib/game/GameContext";
import { ProfileProvider } from "@/lib/game/ProfileContext";
import { RealmProfileModal } from "@/components/RealmProfileModal";
import { GuildProfileModal } from "@/components/GuildProfileModal";
import { NebulaLayer } from "@/components/NebulaLayer";
import { ToastViewport } from "@/components/ToastViewport";
import { GameEventToasts } from "@/components/GameEventToasts";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <GameProvider>
      <ProfileProvider>
        {/* Behind every route: one GL context for the whole session. */}
        <NebulaLayer />
        {/* Watches simulation state and raises toasts for events that happen
            while the player is idle or on another screen. */}
        <GameEventToasts />
        {children}
        <RealmProfileModal />
        <GuildProfileModal />
        <ToastViewport />
      </ProfileProvider>
    </GameProvider>
  );
}
