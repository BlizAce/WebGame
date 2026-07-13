"use client";

import { useState } from "react";
import { PlayGate } from "@/components/PlayGate";
import { useGame } from "@/lib/game/GameContext";
import { RACES } from "@/lib/game/races";
import {
  antiSpyUpgradeCost,
  formatNaq,
  maxTrainAmount,
  spyUpgradeCost,
  trainCost,
  upUpgradeCost,
  uuPerTurn,
} from "@/lib/game/economy";
import { guildUpBonus } from "@/lib/game/guilds";
import type { Realm } from "@/lib/db/schema";

const TRAINABLE: (keyof Realm["units"])[] = [
  "miners",
  "offence",
  "defence",
  "covert",
  "antiCovert",
];

export default function TrainingPage() {
  return (
    <PlayGate stageMode="training">
      <Training />
    </PlayGate>
  );
}

function Training() {
  const {
    player,
    save,
    train,
    untrain,
    upgradeUp,
    upgradeUpMax,
    upgradeSpy,
    upgradeAntiSpy,
  } = useGame();
  const [amount, setAmount] = useState(5);
  const [msg, setMsg] = useState<string | null>(null);

  if (!player || !save) return null;
  const race = RACES[player.race];
  const labels = race.units;
  const planets = save.planets ?? [];
  const guildUu = guildUpBonus(player, save);

  const run = (err: string | null, ok: string) => setMsg(err ?? ok);

  return (
    <>
      <h1 className="gw-title">Training</h1>
      <p className="gw-lead">
        Convert untrained units into specialists. Upgrade Unit Production (UP)
        for more UU every turn — permanent growth enemies cannot steal.
      </p>

      <div className="gw-card">
        <h2>Train units</h2>
        <p style={{ color: "var(--gw-muted)", marginTop: 0 }}>
          Available UU: {formatNaq(player.units.untrained)} · Miners:{" "}
          {formatNaq(player.units.miners ?? 0)}
        </p>
        <div className="gw-field" style={{ maxWidth: 160, marginBottom: "0.75rem" }}>
          <label htmlFor="amt">Amount</label>
          <input
            id="amt"
            className="gw-input"
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </div>
        {TRAINABLE.map((kind) => {
          const max = maxTrainAmount(player, kind);
          return (
            <div key={kind} className="gw-row" style={{ marginBottom: "0.55rem" }}>
              <button
                type="button"
                className="gw-btn"
                onClick={() =>
                  run(
                    train(kind, amount),
                    `Trained ${amount} ${labels[kind]} (−${trainCost(kind) * amount} Naq)`,
                  )
                }
              >
                → {labels[kind]} ×{amount} ({trainCost(kind)} Naq ea)
              </button>
              <button
                type="button"
                className="gw-btn gw-btn-ghost"
                disabled={max < 1}
                onClick={() => {
                  if (max < 1) return;
                  run(
                    train(kind, max),
                    `Trained max ${max} ${labels[kind]}`,
                  );
                }}
              >
                Buy Max ({max})
              </button>
              <button
                type="button"
                className="gw-btn gw-btn-ghost"
                onClick={() =>
                  run(untrain(kind, amount), `Untrained ${amount} ${labels[kind]}`)
                }
              >
                ← Untrain
              </button>
            </div>
          );
        })}
      </div>

      <div className="gw-card">
        <h2>Unit Production (UP)</h2>
        <div className="gw-stats" style={{ marginBottom: "1rem" }}>
          <div className="gw-stat">
            <span>UP level</span>
            <strong>{player.unitProductionLevel}</strong>
          </div>
          <div className="gw-stat">
            <span>UU / turn</span>
            <strong>{uuPerTurn(player, planets, guildUu)}</strong>
          </div>
          <div className="gw-stat">
            <span>Next UP cost</span>
            <strong>
              {formatNaq(upUpgradeCost(player.unitProductionLevel))} Naq
            </strong>
          </div>
        </div>
        <div className="gw-row">
          <button
            type="button"
            className="gw-btn"
            onClick={() =>
              run(upgradeUp(), `UP → ${player.unitProductionLevel + 1}`)
            }
          >
            Increase UP (+1)
          </button>
          <button
            type="button"
            className="gw-btn gw-btn-ghost"
            onClick={() => {
              const { count, error } = upgradeUpMax(10);
              setMsg(
                count > 0
                  ? `Increased UP by ${count} level(s)`
                  : error ?? "Could not upgrade UP",
              );
            }}
          >
            Buy Max UP (up to 10)
          </button>
        </div>
      </div>

      <div className="gw-card">
        <h2>Spy / Anti-Spy levels</h2>
        <div className="gw-stats" style={{ marginBottom: "1rem" }}>
          <div className="gw-stat">
            <span>Spy Level</span>
            <strong>Lv {player.spyLevel}</strong>
          </div>
          <div className="gw-stat">
            <span>Anti-Spy Level</span>
            <strong>Lv {player.antiSpyLevel}</strong>
          </div>
        </div>
        <div className="gw-row">
          <button
            type="button"
            className="gw-btn"
            onClick={() => run(upgradeSpy(), `Spy → ${player.spyLevel + 1}`)}
          >
            Upgrade Spy ({formatNaq(spyUpgradeCost(player.spyLevel))} Naq)
          </button>
          <button
            type="button"
            className="gw-btn"
            onClick={() =>
              run(upgradeAntiSpy(), `Anti-Spy → ${player.antiSpyLevel + 1}`)
            }
          >
            Upgrade Anti-Spy ({formatNaq(antiSpyUpgradeCost(player.antiSpyLevel))}{" "}
            Naq)
          </button>
        </div>
      </div>
      {msg && <div className="gw-msg">{msg}</div>}
    </>
  );
}
