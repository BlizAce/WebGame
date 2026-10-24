"use client";

/**
 * Toast viewport: renders the live toast stack and owns auto-dismiss timing.
 *
 * Mounted once in Providers so toasts survive route changes — important because
 * several of them (turn ticks, incoming raids, mail) are raised from background
 * simulation rather than from the screen the player happens to be looking at.
 */
import { useEffect } from "react";
import { dismissToast, useToasts, type ToastKind } from "@/lib/ui/toast";

/** Icon per kind, drawn inline so there is no icon font dependency. */
const ICONS: Record<ToastKind, string> = {
  info: "M12 8h.01M11 12h1v4h1",
  success: "M5 13l4 4L19 7",
  warn: "M12 9v4m0 3h.01",
  danger: "M6 6l12 12M18 6L6 18",
};

export function ToastViewport() {
  const toasts = useToasts();

  // One timer drives every expiry; re-armed whenever the stack changes. Idle
  // (pinned-only) stacks cost nothing.
  useEffect(() => {
    const timers = toasts
      .filter((t) => t.ttl > 0)
      .map((t) => {
        const remaining = t.at + t.ttl - Date.now();
        return window.setTimeout(
          () => dismissToast(t.id),
          Math.max(0, remaining),
        );
      });
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [toasts]);

  if (!toasts.length) return null;

  return (
    <div className="gw-toasts" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`gw-toast gw-toast-${t.kind}`}>
          <svg
            className="gw-toast-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" opacity="0.45" />
            <path d={ICONS[t.kind]} />
          </svg>
          <div className="gw-toast-text">
            <div className="gw-toast-title">{t.title}</div>
            {t.body ? <div className="gw-toast-body">{t.body}</div> : null}
          </div>
          <button
            type="button"
            className="gw-toast-close"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
