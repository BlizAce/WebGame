"use client";

import { useState } from "react";
import Link from "next/link";
import { PlayGate } from "@/components/PlayGate";
import { useGame } from "@/lib/game/GameContext";
import {
  ensureTech,
  formatNaq,
  maxBuyWeaponAmount,
} from "@/lib/game/economy";

export default function ArmoryPage() {
  return (
    <PlayGate stageMode="armory">
      <Armory />
    </PlayGate>
  );
}

function Armory() {
  const { player, buyWeapon, repairWeapon, sellWeapon } = useGame();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<string | null>(null);

  if (!player) return null;
  const tech = ensureTech(player);
  const ms = player.mothership;

  const run = (err: string | null, ok: string) => {
    setMsg(err ?? ok);
  };

  return (
    <>
      <h1 className="gw-title">Armory</h1>
      <p className="gw-lead">
        Buy, repair, or sell weapons. Higher Equipment tech unlocks elite gear.
        Capital ships live in the{" "}
        <Link href="/play/mothership" style={{ color: "var(--race-glow)" }}>
          Mothership Bay
        </Link>
        .
      </p>

      <div className="gw-card">
        <h2>Fleet link</h2>
        <div className="gw-stats" style={{ marginBottom: "0.75rem" }}>
          <div className="gw-stat">
            <span>Mothership</span>
            <strong>{ms?.name ?? "None"}</strong>
          </div>
          <div className="gw-stat">
            <span>Tier</span>
            <strong>{ms?.tier ?? 0} / 12</strong>
          </div>
          <div className="gw-stat">
            <span>Power</span>
            <strong>{formatNaq(ms?.power ?? 0)}</strong>
          </div>
        </div>
        <Link href="/play/mothership" className="gw-btn">
          Open mothership bay
        </Link>
      </div>

      <div className="gw-card">
        <h2>Inventory</h2>
        <table className="gw-table">
          <thead>
            <tr>
              <th>Weapon</th>
              <th>Slot</th>
              <th>Power</th>
              <th>Qty</th>
              <th>Durability</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {player.weapons
              .filter((w) => w.quantity > 0)
              .map((w) => (
                <tr key={w.id}>
                  <td>{w.name}</td>
                  <td>{w.slot}</td>
                  <td>{w.power}</td>
                  <td>{w.quantity}</td>
                  <td>
                    {w.durability}/{w.maxDurability}
                  </td>
                  <td>
                    <div className="gw-row">
                      <button
                        type="button"
                        className="gw-btn gw-btn-ghost"
                        disabled={w.durability >= w.maxDurability}
                        onClick={() =>
                          run(repairWeapon(w.id), `Repaired ${w.name}`)
                        }
                      >
                        Repair
                      </button>
                      <button
                        type="button"
                        className="gw-btn gw-btn-ghost"
                        onClick={() =>
                          run(sellWeapon(w.id, 1), `Sold 1× ${w.name}`)
                        }
                      >
                        Sell 1
                      </button>
                      <button
                        type="button"
                        className="gw-btn gw-btn-danger"
                        onClick={() =>
                          run(
                            sellWeapon(w.id, w.quantity),
                            `Sold all ${w.name}`,
                          )
                        }
                      >
                        Sell all
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="gw-card">
        <h2>Buy weapons</h2>
        <p style={{ color: "var(--gw-muted)", fontSize: "0.85rem" }}>
          Equipment tech {tech.equipment}. Locked gear shows its requirement.
        </p>
        <table className="gw-table">
          <thead>
            <tr>
              <th>Weapon</th>
              <th>Slot</th>
              <th>Power</th>
              <th>Cost</th>
              <th>Tech</th>
              <th>Qty</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {player.weapons.map((w) => {
              const locked = tech.equipment < (w.techReq ?? 1);
              const max = maxBuyWeaponAmount(player, w);
              return (
                <tr key={w.id} style={locked ? { opacity: 0.45 } : undefined}>
                  <td>{w.name}</td>
                  <td>{w.slot}</td>
                  <td>{w.power}</td>
                  <td>{formatNaq(w.buyCost)}</td>
                  <td>{w.techReq ?? 1}</td>
                  <td>
                    <input
                      className="gw-input"
                      style={{ width: 72 }}
                      type="number"
                      min={1}
                      value={qty[w.id] ?? 1}
                      disabled={locked}
                      onChange={(e) =>
                        setQty((q) => ({
                          ...q,
                          [w.id]: Number(e.target.value),
                        }))
                      }
                    />
                  </td>
                  <td>
                    <div className="gw-row">
                      <button
                        type="button"
                        className="gw-btn"
                        disabled={locked || max < 1}
                        onClick={() =>
                          run(
                            buyWeapon(w.id, qty[w.id] ?? 1),
                            `Bought ${qty[w.id] ?? 1}× ${w.name}`,
                          )
                        }
                      >
                        Buy
                      </button>
                      <button
                        type="button"
                        className="gw-btn gw-btn-ghost"
                        disabled={locked || max < 1}
                        onClick={() =>
                          run(buyWeapon(w.id, max), `Bought max ${max}× ${w.name}`)
                        }
                      >
                        Max
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {msg && <div className="gw-msg">{msg}</div>}
    </>
  );
}
