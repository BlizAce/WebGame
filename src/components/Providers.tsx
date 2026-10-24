"use client";

import { GameProvider } from "@/lib/game/GameContext";
import { ProfileProvider } from "@/lib/game/ProfileContext";
import { RealmProfileModal } from "@/components/RealmProfileModal";
import { GuildProfileModal } from "@/components/GuildProfileModal";
import { NebulaLayer } from "@/components/NebulaLayer";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <GameProvider>
      <ProfileProvider>
        {/* Behind every route: one GL context for the whole session. */}
        <NebulaLayer />
        {children}
        <RealmProfileModal />
        <GuildProfileModal />
      </ProfileProvider>
    </GameProvider>
  );
}
