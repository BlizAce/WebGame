"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { VectorStage } from "@/components/VectorStage";
import { RaceWirePreview } from "@/components/RaceWirePreview";
import { useGame } from "@/lib/game/GameContext";
import { RACE_LIST } from "@/lib/game/races";
import type { RaceId } from "@/lib/db/schema";

export default function HomePage() {
  const { player, ready, startGame } = useGame();
  const router = useRouter();
  const [name, setName] = useState("Commander");
  const [race, setRace] = useState<RaceId>("tauri");
  const selected = RACE_LIST.find((r) => r.id === race)!;

  useEffect(() => {
    if (ready && player) router.replace("/play/command-center");
  }, [ready, player, router]);

  if (!ready) {
    return (
      <div className="gw-loading">
        <div className="gw-loading-ring" aria-hidden />
        <span>Calibrating gate…</span>
      </div>
    );
  }

  if (player) {
    return null;
  }

  return (
    <div
      className="gw-landing"
      style={
        {
          "--race-primary": selected.colors.primary,
          "--race-glow": selected.colors.glow,
          "--race-accent": selected.colors.accent,
          "--race-secondary": selected.colors.secondary,
        } as React.CSSProperties
      }
    >
      <section className="gw-hero">
        <div className="gw-hero-stage">
          <VectorStage race={race} mode="command" intensity={1.15} />
        </div>
        <div className="gw-hero-copy">
          <h1>GATEWARS</h1>
          <p>
            Build your realm, stockpile Naquadah, and strike through the gate.
            Local sandbox with a server SQLite save.
          </p>
          <div className="gw-hero-cta">
            <a className="gw-btn" href="#establish">
              Establish realm
            </a>
          </div>
        </div>
      </section>

      <section
        id="establish"
        className="gw-panel"
        style={{ maxWidth: 900, margin: "0 auto" }}
      >
        <div className="gw-card">
          <h2>Establish Realm</h2>
          <div className="gw-row" style={{ marginBottom: "1rem" }}>
            <div className="gw-field" style={{ flex: 1 }}>
              <label htmlFor="name">Commander name</label>
              <input
                id="name"
                className="gw-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={24}
              />
            </div>
          </div>

          <div className="gw-race-grid">
            {RACE_LIST.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`gw-race ${race === r.id ? "is-selected" : ""}`}
                onClick={() => setRace(r.id)}
                style={
                  race === r.id
                    ? ({
                        "--race-primary": r.colors.primary,
                        "--race-glow": r.colors.glow,
                      } as React.CSSProperties)
                    : undefined
                }
              >
                <RaceWirePreview race={r.id} active={race === r.id} />
                <h3 style={{ color: r.colors.accent }}>{r.name}</h3>
                <p>{r.tagline}</p>
              </button>
            ))}
          </div>

          <div className="gw-row" style={{ marginTop: "1.25rem" }}>
            <button
              type="button"
              className="gw-btn"
              onClick={() => {
                startGame(name, race);
                router.push("/play/command-center");
              }}
            >
              Dial in & begin
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
