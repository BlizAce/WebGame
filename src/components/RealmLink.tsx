"use client";

import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { useProfile } from "@/lib/game/ProfileContext";

type Props = {
  realmId?: string | null;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
};

/**
 * Clickable commander name — opens the shared realm profile modal.
 * Renders plain text when realmId is missing (e.g. planet names in logs).
 */
export function RealmLink({
  realmId,
  children,
  className,
  style,
  title,
}: Props) {
  const { openRealm } = useProfile();

  if (!realmId) {
    return <span className={className} style={style}>{children}</span>;
  }

  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openRealm(realmId);
  };

  return (
    <button
      type="button"
      className={`gw-realm-link ${className ?? ""}`.trim()}
      style={style}
      title={title ?? "View profile"}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
