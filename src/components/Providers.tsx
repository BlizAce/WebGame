"use client";

import { GameProvider } from "@/lib/game/GameContext";
import { ProfileProvider } from "@/lib/game/ProfileContext";
import { RealmProfileModal } from "@/components/RealmProfileModal";
import { GuildProfileModal } from "@/components/GuildProfileModal";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <GameProvider>
      <ProfileProvider>
        {children}
        <RealmProfileModal />
        <GuildProfileModal />
      </ProfileProvider>
    </GameProvider>
  );
}
