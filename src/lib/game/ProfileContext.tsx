"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type ProfileContextValue = {
  openRealm: (realmId: string | null | undefined) => void;
  closeRealm: () => void;
  activeRealmId: string | null;
  openGuild: (allianceId: string | null | undefined) => void;
  closeGuild: () => void;
  activeGuildId: string | null;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [activeRealmId, setActiveRealmId] = useState<string | null>(null);
  const [activeGuildId, setActiveGuildId] = useState<string | null>(null);

  const openRealm = useCallback((realmId: string | null | undefined) => {
    if (!realmId) return;
    setActiveGuildId(null);
    setActiveRealmId(realmId);
  }, []);

  const closeRealm = useCallback(() => setActiveRealmId(null), []);

  const openGuild = useCallback((allianceId: string | null | undefined) => {
    if (!allianceId) return;
    setActiveRealmId(null);
    setActiveGuildId(allianceId);
  }, []);

  const closeGuild = useCallback(() => setActiveGuildId(null), []);

  const value = useMemo(
    () => ({
      openRealm,
      closeRealm,
      activeRealmId,
      openGuild,
      closeGuild,
      activeGuildId,
    }),
    [
      openRealm,
      closeRealm,
      activeRealmId,
      openGuild,
      closeGuild,
      activeGuildId,
    ],
  );

  return (
    <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
  );
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error("useProfile must be within ProfileProvider");
  }
  return ctx;
}
