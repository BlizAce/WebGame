"use client";

import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { useProfile } from "@/lib/game/ProfileContext";

type Props = {
  allianceId?: string | null;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
};

/** Clickable guild name/tag — opens the guild roster modal. */
export function GuildLink({
  allianceId,
  children,
  className,
  style,
  title,
}: Props) {
  const { openGuild } = useProfile();

  if (!allianceId) {
    return (
      <span className={className} style={style}>
        {children}
      </span>
    );
  }

  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openGuild(allianceId);
  };

  return (
    <button
      type="button"
      className={`gw-realm-link ${className ?? ""}`.trim()}
      style={style}
      title={title ?? "View guild roster"}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
