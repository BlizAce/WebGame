"use client";

/**
 * Global keyboard shortcuts: jump between screens, toggle the sidebar on small
 * screens, and open this help.
 *
 * Keys are chosen to avoid colliding with text entry — every handler bails when
 * focus is in an input, textarea, select or contenteditable element, which is
 * what makes single-letter bindings safe here. Plain number keys beat Alt+digit
 * because browser tab-switching already owns Alt+number.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Shortcut = {
  keys: string;
  label: string;
  /** Route to push, or omit for action-only rows. */
  go?: string;
};

/** Order matches the sidebar, so the numbers read like the menu. */
export const SHORTCUTS: Shortcut[] = [
  { keys: "1", label: "Command Center", go: "/play/command-center" },
  { keys: "2", label: "Rankings", go: "/play/rankings" },
  { keys: "3", label: "Attack", go: "/play/attack" },
  { keys: "4", label: "Attack Log", go: "/play/attack-log" },
  { keys: "5", label: "Armory", go: "/play/armory" },
  { keys: "6", label: "Mothership", go: "/play/mothership" },
  { keys: "7", label: "Training", go: "/play/training" },
  { keys: "8", label: "Technology", go: "/play/technology" },
  { keys: "9", label: "Planets", go: "/play/planets" },
  { keys: "0", label: "Guilds", go: "/play/guilds" },
  { keys: "Q", label: "War Room", go: "/play/war-room" },
  { keys: "W", label: "Contracts", go: "/play/contracts" },
  { keys: "E", label: "Open Market", go: "/play/market" },
  { keys: "R", label: "Forum", go: "/play/forum" },
  { keys: "T", label: "Mail", go: "/play/mail" },
  { keys: "A", label: "Ascension", go: "/play/ascension" },
  { keys: "S", label: "Intelligence", go: "/play/intelligence" },
  { keys: "D", label: "Bank / Vault", go: "/play/bank" },
  { keys: "G", label: "Settings", go: "/play/settings" },
];

/** Non-navigating bindings, shown alongside the route list in help. */
export const ACTION_SHORTCUTS: Shortcut[] = [
  { keys: "M", label: "Toggle menu (small screens)" },
  { keys: "?", label: "Show or hide this help" },
  { keys: "Esc", label: "Close this help" },
];

/** True when a keystroke belongs to a form control, not to us. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function useKeyboardShortcuts({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);

  const toggleHelp = useCallback(() => setHelpOpen((v) => !v), []);

  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      // Never hijack modifier combos (browser/OS own those) or typing.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditable(e.target)) return;

      if (e.key === "Escape") {
        setHelpOpen(false);
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        toggleHelp();
        return;
      }
      if (e.key.toLowerCase() === "m") {
        // Sidebar drawer toggle lives on the shell; broadcast via a DOM event so
        // this hook stays independent of it.
        window.dispatchEvent(new CustomEvent("gw:toggle-menu"));
        return;
      }

      const match = SHORTCUTS.find((s) => s.keys.toLowerCase() === e.key.toLowerCase());
      if (match?.go) {
        e.preventDefault();
        router.push(match.go);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, router, toggleHelp]);

  return { helpOpen, setHelpOpen, toggleHelp };
}

/** The overlay itself; rendered by the shell. */
export function ShortcutHelp({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  const items = [...SHORTCUTS, ...ACTION_SHORTCUTS];

  return (
    <div
      className="gw-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div className="gw-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gw-modal-head">
          <div>
            <h2 className="gw-modal-title">Keyboard shortcuts</h2>
            <p className="gw-modal-sub">
              Disabled automatically while typing in a field.
            </p>
          </div>
          <button type="button" className="gw-btn gw-btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="gw-keys">
          {items.map((s) => (
            <div key={s.keys} className="gw-key-row">
              <kbd>{s.keys}</kbd>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
