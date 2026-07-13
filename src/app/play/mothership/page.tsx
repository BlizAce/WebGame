"use client";

import { useState } from "react";
import { PlayGate } from "@/components/PlayGate";
import { useGame } from "@/lib/game/GameContext";
import {
  formatNaq,
  mothershipPartUpgradeCost,
  mothershipUpgradeCost,
  mothershipCapacityUpgradeCost,
  mothershipArmamentUnitCost,
  ensureMothershipParts,
  MOTHERSHIP_PART_META,
  MOTHERSHIP_MODULE_IDS,
  MOTHERSHIP_MAX_TIER,
  mothershipConquerBonus,
} from "@/lib/game/economy";
import type { MothershipModuleId } from "@/lib/game/economy";

export default function MothershipPage() {
  return (
    <PlayGate stageMode="mothership">
      <MothershipBay />
    </PlayGate>
  );
}

function MothershipBay() {
  const {
    player,
    upgradeMothership,
    upgradeMothershipMax,
    upgradeMothershipPart,
    upgradeMothershipPartMax,
    expandMothershipCapacity,
    expandMothershipCapacityMax,
    installMothershipArmament,
    installMothershipArmamentMax,
    repairMothership,
  } = useGame();
  const [msg, setMsg] = useState<string | null>(null);
  const [weaponQty, setWeaponQty] = useState(1);
  const [shieldQty, setShieldQty] = useState(1);

  if (!player) return null;
  const ms = player.mothership;
  const parts = ms ? ensureMothershipParts(ms) : null;
  const run = (err: string | null, ok: string) => setMsg(err ?? ok);
  const runMax = (
    result: { count: number; error: string | null },
    label: string,
  ) =>
    setMsg(
      result.count > 0
        ? `${label} +${result.count}`
        : (result.error ?? "Could not buy"),
    );

  const repairCost =
    ms && ms.tier > 0 && ms.hull < ms.maxHull
      ? Math.ceil((ms.maxHull - ms.hull) * 2.5)
      : 0;

  const freeWeapons = parts
    ? Math.max(0, parts.weaponCapacity - parts.weapons)
    : 0;
  const freeShields = parts
    ? Math.max(0, parts.shieldCapacity - parts.shields)
    : 0;

  const weaponUnit = mothershipArmamentUnitCost("weapons");
  const shieldUnit = mothershipArmamentUnitCost("shields");
  const maxWeaponsAffordable = Math.min(
    freeWeapons,
    Math.floor(player.naquadah / weaponUnit),
  );
  const maxShieldsAffordable = Math.min(
    freeShields,
    Math.floor(player.naquadah / shieldUnit),
  );

  return (
    <>
      <h1 className="gw-title">Mothership Bay</h1>
      <p className="gw-lead">
        Classic Gate Wars loop: expand weapon/shield capacity, then fill the
        bays at a flat unit cost. Reactor and command keep a late-game hull
        relevant — combat can scrap fitted banks.
      </p>

      <div className="gw-card">
        <h2>Capital hull</h2>
        <div className="gw-stats" style={{ marginBottom: "0.85rem" }}>
          <div className="gw-stat">
            <span>Class</span>
            <strong>{ms?.name ?? "None"}</strong>
          </div>
          <div className="gw-stat">
            <span>Tier</span>
            <strong>
              {ms?.tier ?? 0} / {MOTHERSHIP_MAX_TIER}
            </strong>
          </div>
          <div className="gw-stat">
            <span>Fleet power</span>
            <strong>{formatNaq(ms?.power ?? 0)}</strong>
          </div>
          <div className="gw-stat">
            <span>Hull</span>
            <strong>{ms?.tier ? `${ms.hull} / ${ms.maxHull}` : "—"}</strong>
          </div>
          <div className="gw-stat">
            <span>Conquer bonus</span>
            <strong>+{formatNaq(mothershipConquerBonus(player))}</strong>
          </div>
        </div>
        <div className="gw-row">
          <button
            type="button"
            className="gw-btn"
            disabled={(ms?.tier ?? 0) >= MOTHERSHIP_MAX_TIER}
            onClick={() =>
              run(
                upgradeMothership(),
                (ms?.tier ?? 0) < 1
                  ? "Mothership commissioned"
                  : `Hull tier → ${(ms?.tier ?? 0) + 1}`,
              )
            }
          >
            {(ms?.tier ?? 0) < 1 ? "Commission mothership" : "Upgrade hull tier"}{" "}
            ({formatNaq(mothershipUpgradeCost(ms?.tier ?? 0))} Naq)
          </button>
          <button
            type="button"
            className="gw-btn gw-btn-ghost"
            disabled={
              (ms?.tier ?? 0) >= MOTHERSHIP_MAX_TIER ||
              player.naquadah < mothershipUpgradeCost(ms?.tier ?? 0)
            }
            onClick={() => runMax(upgradeMothershipMax(), "Hull tier")}
          >
            Buy Max
          </button>
          <button
            type="button"
            className="gw-btn gw-btn-ghost"
            disabled={!ms || ms.tier < 1 || ms.hull >= ms.maxHull}
            onClick={() =>
              run(
                repairMothership(),
                `Hull repaired (−${formatNaq(repairCost)} Naq)`,
              )
            }
          >
            Repair hull
            {repairCost > 0 ? ` (${formatNaq(repairCost)} Naq)` : ""}
          </button>
        </div>
      </div>

      <div className="gw-card">
        <h2>Armament bays</h2>
        {(ms?.tier ?? 0) < 1 ? (
          <p style={{ color: "var(--gw-muted)" }}>
            Commission a mothership before expanding capacity.
          </p>
        ) : (
          <>
            <p className="gw-lead" style={{ marginBottom: "0.85rem" }}>
              Capacity cost rises with ship size; installing banks is flat (
              {formatNaq(weaponUnit)} / weapon, {formatNaq(shieldUnit)} /
              shield).
            </p>
            <table className="gw-table">
              <thead>
                <tr>
                  <th>Bay</th>
                  <th>Fitted / Cap</th>
                  <th>Expand</th>
                  <th>Install</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>Weapons</strong>
                    <div
                      style={{ color: "var(--gw-muted)", fontSize: "0.8rem" }}
                    >
                      {MOTHERSHIP_PART_META.weapons.blurb}
                    </div>
                  </td>
                  <td>
                    {parts!.weapons} / {parts!.weaponCapacity}
                    {freeWeapons > 0 ? (
                      <span style={{ color: "var(--gw-muted)" }}>
                        {" "}
                        ({freeWeapons} free)
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <div className="gw-row" style={{ gap: "0.4rem" }}>
                      <button
                        type="button"
                        className="gw-btn"
                        disabled={
                          player.naquadah <
                          mothershipCapacityUpgradeCost(
                            "weapons",
                            parts!.weaponCapacity,
                          )
                        }
                        onClick={() =>
                          run(
                            expandMothershipCapacity("weapons"),
                            `Weapon capacity → ${parts!.weaponCapacity + 1}`,
                          )
                        }
                      >
                        +1 (
                        {formatNaq(
                          mothershipCapacityUpgradeCost(
                            "weapons",
                            parts!.weaponCapacity,
                          ),
                        )}
                        )
                      </button>
                      <button
                        type="button"
                        className="gw-btn gw-btn-ghost"
                        disabled={
                          player.naquadah <
                          mothershipCapacityUpgradeCost(
                            "weapons",
                            parts!.weaponCapacity,
                          )
                        }
                        onClick={() =>
                          runMax(
                            expandMothershipCapacityMax("weapons"),
                            "Weapon capacity",
                          )
                        }
                      >
                        Buy Max
                      </button>
                    </div>
                  </td>
                  <td>
                    <div className="gw-row" style={{ gap: "0.4rem" }}>
                      <input
                        className="gw-input"
                        type="number"
                        min={1}
                        max={Math.max(1, freeWeapons)}
                        value={weaponQty}
                        style={{ width: 64 }}
                        onChange={(e) =>
                          setWeaponQty(Math.max(1, Number(e.target.value) || 1))
                        }
                      />
                      <button
                        type="button"
                        className="gw-btn"
                        disabled={
                          freeWeapons <= 0 ||
                          player.naquadah <
                            weaponUnit * Math.min(weaponQty, freeWeapons)
                        }
                        onClick={() =>
                          run(
                            installMothershipArmament("weapons", weaponQty),
                            `Installed weapon banks`,
                          )
                        }
                      >
                        Install (
                        {formatNaq(
                          weaponUnit *
                            Math.min(weaponQty, Math.max(1, freeWeapons)),
                        )}
                        )
                      </button>
                      <button
                        type="button"
                        className="gw-btn gw-btn-ghost"
                        disabled={maxWeaponsAffordable <= 0}
                        onClick={() =>
                          runMax(
                            installMothershipArmamentMax("weapons"),
                            "Weapon banks",
                          )
                        }
                      >
                        Buy Max
                        {maxWeaponsAffordable > 0
                          ? ` (${maxWeaponsAffordable})`
                          : ""}
                      </button>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>Shields</strong>
                    <div
                      style={{ color: "var(--gw-muted)", fontSize: "0.8rem" }}
                    >
                      {MOTHERSHIP_PART_META.shields.blurb}
                    </div>
                  </td>
                  <td>
                    {parts!.shields} / {parts!.shieldCapacity}
                    {freeShields > 0 ? (
                      <span style={{ color: "var(--gw-muted)" }}>
                        {" "}
                        ({freeShields} free)
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <div className="gw-row" style={{ gap: "0.4rem" }}>
                      <button
                        type="button"
                        className="gw-btn"
                        disabled={
                          player.naquadah <
                          mothershipCapacityUpgradeCost(
                            "shields",
                            parts!.shieldCapacity,
                          )
                        }
                        onClick={() =>
                          run(
                            expandMothershipCapacity("shields"),
                            `Shield capacity → ${parts!.shieldCapacity + 1}`,
                          )
                        }
                      >
                        +1 (
                        {formatNaq(
                          mothershipCapacityUpgradeCost(
                            "shields",
                            parts!.shieldCapacity,
                          ),
                        )}
                        )
                      </button>
                      <button
                        type="button"
                        className="gw-btn gw-btn-ghost"
                        disabled={
                          player.naquadah <
                          mothershipCapacityUpgradeCost(
                            "shields",
                            parts!.shieldCapacity,
                          )
                        }
                        onClick={() =>
                          runMax(
                            expandMothershipCapacityMax("shields"),
                            "Shield capacity",
                          )
                        }
                      >
                        Buy Max
                      </button>
                    </div>
                  </td>
                  <td>
                    <div className="gw-row" style={{ gap: "0.4rem" }}>
                      <input
                        className="gw-input"
                        type="number"
                        min={1}
                        max={Math.max(1, freeShields)}
                        value={shieldQty}
                        style={{ width: 64 }}
                        onChange={(e) =>
                          setShieldQty(Math.max(1, Number(e.target.value) || 1))
                        }
                      />
                      <button
                        type="button"
                        className="gw-btn"
                        disabled={
                          freeShields <= 0 ||
                          player.naquadah <
                            shieldUnit * Math.min(shieldQty, freeShields)
                        }
                        onClick={() =>
                          run(
                            installMothershipArmament("shields", shieldQty),
                            `Installed shield banks`,
                          )
                        }
                      >
                        Install (
                        {formatNaq(
                          shieldUnit *
                            Math.min(shieldQty, Math.max(1, freeShields)),
                        )}
                        )
                      </button>
                      <button
                        type="button"
                        className="gw-btn gw-btn-ghost"
                        disabled={maxShieldsAffordable <= 0}
                        onClick={() =>
                          runMax(
                            installMothershipArmamentMax("shields"),
                            "Shield banks",
                          )
                        }
                      >
                        Buy Max
                        {maxShieldsAffordable > 0
                          ? ` (${maxShieldsAffordable})`
                          : ""}
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="gw-card">
        <h2>Ship systems</h2>
        {(ms?.tier ?? 0) < 1 ? (
          <p style={{ color: "var(--gw-muted)" }}>
            Commission a mothership before installing modular upgrades.
          </p>
        ) : (
          <table className="gw-table">
            <thead>
              <tr>
                <th>System</th>
                <th>Level</th>
                <th>Effect</th>
                <th>Next cost</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {MOTHERSHIP_MODULE_IDS.map((id) => {
                const meta = MOTHERSHIP_PART_META[id];
                const level = parts?.[id] ?? 0;
                const maxed = level >= meta.max;
                const cost = mothershipPartUpgradeCost(id, level);
                return (
                  <tr key={id}>
                    <td>
                      <strong>{meta.label}</strong>
                      <div
                        style={{
                          color: "var(--gw-muted)",
                          fontSize: "0.8rem",
                        }}
                      >
                        {meta.blurb}
                      </div>
                    </td>
                    <td>
                      {level} / {meta.max}
                    </td>
                    <td>{moduleEffectLabel(id, level, ms?.tier ?? 1)}</td>
                    <td>{maxed ? "—" : `${formatNaq(cost)} Naq`}</td>
                    <td>
                      <div className="gw-row" style={{ gap: "0.4rem" }}>
                        <button
                          type="button"
                          className="gw-btn"
                          disabled={maxed || player.naquadah < cost}
                          onClick={() =>
                            run(
                              upgradeMothershipPart(id),
                              `${meta.label} → Lv ${level + 1}`,
                            )
                          }
                        >
                          Upgrade
                        </button>
                        <button
                          type="button"
                          className="gw-btn gw-btn-ghost"
                          disabled={maxed || player.naquadah < cost}
                          onClick={() =>
                            runMax(
                              upgradeMothershipPartMax(id),
                              meta.label,
                            )
                          }
                        >
                          Buy Max
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {msg && <div className="gw-msg">{msg}</div>}
    </>
  );
}

function moduleEffectLabel(
  id: MothershipModuleId,
  level: number,
  tier: number,
): string {
  if (level <= 0) return "—";
  switch (id) {
    case "hull":
      return `+${level * 10}% max hull`;
    case "engines":
      return `+${level * (40 + tier * 8)} conquer`;
    case "sensors":
      return `+${level * (18 + tier * 4)} conquer`;
    case "hangar":
      return `+${level * (20 + tier * 4)} power`;
    case "reactor":
      return `+${level * 5}% armament output`;
    case "armor":
      return `+${level * 12}% hull · toughness`;
    case "command":
      return `+${level * (16 + tier * 5)} fleet power`;
    default:
      return "—";
  }
}
