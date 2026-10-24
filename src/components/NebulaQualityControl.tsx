"use client";

/**
 * Backdrop quality control: High / Low / Off.
 *
 * Device-level preference, so it lives in localStorage rather than the game
 * save — the save is portable/exportable and must not carry another machine's
 * GPU settings.
 */
import { useNebulaQuality, type Quality } from "@/lib/gfx/nebulaTheme";

const OPTIONS: { id: Quality; label: string; hint: string }[] = [
  { id: "high", label: "High", hint: "Full nebula detail — best on discrete GPUs" },
  { id: "low", label: "Low", hint: "Reduced detail and resolution" },
  { id: "off", label: "Off", hint: "Static gradient only — lowest power use" },
];

type Props = {
  className?: string;
};

export function NebulaQualityControl({ className = "" }: Props) {
  const { quality, setQuality } = useNebulaQuality();

  return (
    <div
      className={`gw-quality ${className}`}
      role="radiogroup"
      aria-label="Background graphics quality"
    >
      <span className="gw-quality-label">Graphics</span>
      <div className="gw-quality-seg">
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={quality === o.id}
            title={o.hint}
            className={`gw-quality-btn${quality === o.id ? " is-active" : ""}`}
            onClick={() => setQuality(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
