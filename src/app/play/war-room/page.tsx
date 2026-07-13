"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PlayGate } from "@/components/PlayGate";
import { RealmLink } from "@/components/RealmLink";
import { useGame } from "@/lib/game/GameContext";
import { RACES } from "@/lib/game/races";
import {
  formatNaq,
  formatNaqExact,
  strikeAction,
} from "@/lib/game/economy";
import { cachedOverallScore, isBelowAttackRankRange, maxAttackableRankFor, overallRankOf } from "@/lib/game/rankings";
import { effectiveDefencePotential, getClusterForRealm } from "@/lib/game/fleetClusters";
import type { AttackLogEntry, GuildWar, IntelLogEntry } from "@/lib/db/schema";
import { getAlliance } from "@/lib/game/guilds";
import {
  enemyGuildLabel,
  eradicationChance,
  eradicationPowerRatio,
  ERADICATION_TURN_COST,
  warEnemyMembers,
  warsForGuild,
} from "@/lib/game/wars";
import { BattleScene } from "@/components/BattleScene";

export default function WarRoomPage() {
  return (
    <PlayGate stageMode="war">
      <WarRoom />
    </PlayGate>
  );
}

function WarRoom() {
  const { save, player, attack, eradicate, spy, sabotage, assassinate, endWar } = useGame();
  const [selectedWarId, setSelectedWarId] = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [turns, setTurns] = useState(8);
  const [agents, setAgents] = useState(3);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [warMsg, setWarMsg] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [beatableOnly, setBeatableOnly] = useState(false);
  const [battleLog, setBattleLog] = useState<AttackLogEntry | null>(null);

  const myWars = useMemo(() => {
    if (!save || !player?.allianceId) return [];
    return warsForGuild(save, player.allianceId);
  }, [save, player]);

  const selectedWar: GuildWar | null =
    myWars.find((w) => w.id === selectedWarId) ?? myWars[0] ?? null;

  const enemies = useMemo(() => {
    if (!save || !player?.allianceId || !selectedWar) return [];
    const planets = save.planets ?? [];
    const myStrike = strikeAction(player, planets);
    const byId = save.rankingsCache?.byId;
    return warEnemyMembers(save, selectedWar, player.allianceId)
      .map((r) => {
        const snap = byId?.[r.id];
        const def = effectiveDefencePotential(r, planets, save);
        const cluster = getClusterForRealm(save, r.id);
        const inRankRange = !isBelowAttackRankRange(save, player.id, r.id);
        return {
          realm: r,
          score: snap?.overall ?? cachedOverallScore(save, r.id),
          def,
          clustered: !!(cluster && cluster.memberIds.length > 1),
          clusterSize: cluster?.memberIds.length ?? 0,
          inRankRange,
          beatable: inRankRange && myStrike > def,
          guild: getAlliance(save, r.allianceId),
        };
      })
      .sort((a, b) => b.score - a.score);
  }, [save, player, selectedWar, save?.rankingsCache?.refreshedAt]);

  const visibleEnemies = beatableOnly
    ? enemies.filter((e) => e.beatable)
    : enemies;

  if (!player || !save) return null;

  if (!player.allianceId) {
    return (
      <>
        <h1 className="gw-title">Guild War Room</h1>
        <p className="gw-lead">
          Join or found a guild first, then declare war from the{" "}
          <Link href="/play/guilds" style={{ color: "var(--race-glow)" }}>
            Guilds
          </Link>{" "}
          page. Wartime enemies appear here for targeting.
        </p>
        <div className="gw-card">
          <p style={{ color: "var(--gw-muted)" }}>
            You are not in a guild — no war theatre available.
          </p>
          <Link href="/play/guilds" className="gw-btn">
            Open Guilds
          </Link>
        </div>
      </>
    );
  }

  const planets = save.planets ?? [];
  const myGuild = getAlliance(save, player.allianceId);
  const target =
    enemies.find((e) => e.realm.id === selectedTargetId)?.realm ??
    save.realms.find((r) => r.id === selectedTargetId);
  const targetInRankRange = target
    ? !isBelowAttackRankRange(save, player.id, target.id)
    : false;
  const isLeader = myGuild?.leaderId === player.id;

  const report = (result: AttackLogEntry | IntelLogEntry | string) => {
    if (typeof result === "string") {
      setBattleLog(null);
      setMsg({ ok: false, text: result });
    } else if ("summary" in result) {
      setBattleLog(result);
      setMsg({ ok: true, text: result.summary });
    } else {
      setBattleLog(null);
      setMsg({ ok: true, text: result.details });
    }
  };

  return (
    <>
      <h1 className="gw-title">Guild War Room</h1>
      <p className="gw-lead">
        Active wars for [{myGuild?.tag}] {myGuild?.name}. Select an enemy guild,
        then strike members directly. At ≥10× defence, attacks roll eradication
        (5% per 10× tier) — or spend 10 turns on Eradicate.
      </p>

      <div className="gw-tips">
        <h3>War tips</h3>
        <ul>
          <li>
            <strong>Declare / end:</strong> only your guild leader can declare
            war (Guilds rankings) or sue for peace (End war).
          </li>
          <li>
            <strong>Annihilate AI:</strong> win an attack while at war, with
            roughly 2.2× their overall score, after their offence+defence units
            are gutted (≤8). About half of those crushing wins destroy them —
            dead shells stay listed; a new AI signal replaces them.
          </li>
          <li>
            <strong>Players:</strong> wartime wins gut a player realm but do not
            permanently delete the account.
          </li>
          <li>
            <strong>How to finish someone:</strong> raid/attack to strip Naq and
            units, keep hitting until their army is tiny, then land a big
            wartime Attack for the annihilation roll.
          </li>
        </ul>
      </div>

      <div className="gw-card">
        <h2>Your wars ({myWars.length})</h2>
        {myWars.length === 0 ? (
          <>
            <p style={{ color: "var(--gw-muted)" }}>
              No active wars.{" "}
              {isLeader
                ? "As leader, declare war from Guilds rankings."
                : "Ask your guild leader to declare war."}
            </p>
            <Link href="/play/guilds" className="gw-btn gw-btn-ghost">
              Go to Guilds
            </Link>
          </>
        ) : (
          <>
            <div className="gw-row" style={{ marginBottom: "0.5rem" }}>
              {myWars.map((w) => {
                const label = enemyGuildLabel(w, player.allianceId!);
                const active = (selectedWar?.id ?? myWars[0]?.id) === w.id;
                const count = warEnemyMembers(save, w, player.allianceId!).length;
                const weAttack = w.attackerAllianceId === player.allianceId;
                return (
                  <button
                    key={w.id}
                    type="button"
                    className={`gw-btn ${active ? "" : "gw-btn-ghost"}`}
                    onClick={() => {
                      setSelectedWarId(w.id);
                      setSelectedTargetId(null);
                      setMsg(null);
                      setWarMsg(null);
                    }}
                  >
                    vs {label} ({count}) · {w.killsAttacker}:{w.killsDefender}
                    {weAttack ? " · attacking" : " · defending"}
                  </button>
                );
              })}
            </div>
            {isLeader && selectedWar && (
              <div className="gw-row" style={{ marginTop: "0.5rem" }}>
                <button
                  type="button"
                  className="gw-btn gw-btn-ghost"
                  onClick={() => {
                    const err = endWar(selectedWar.id);
                    if (err) setWarMsg({ ok: false, text: err });
                    else {
                      setWarMsg({ ok: true, text: "War ended — peace declared." });
                      setSelectedWarId(null);
                    }
                  }}
                >
                  End war vs{" "}
                  {enemyGuildLabel(selectedWar, player.allianceId)}
                </button>
              </div>
            )}
            {warMsg && (
              <div className={`gw-msg ${warMsg.ok ? "ok" : "err"}`}>
                {warMsg.text}
              </div>
            )}
          </>
        )}
      </div>

      {selectedWar && (
        <div className="gw-card">
          <h2>
            Enemy roster — {enemyGuildLabel(selectedWar, player.allianceId)}
          </h2>
          <div className="gw-row" style={{ marginBottom: "0.75rem" }}>
            <button
              type="button"
              className={`gw-btn ${beatableOnly ? "" : "gw-btn-ghost"}`}
              onClick={() => setBeatableOnly((v) => !v)}
            >
              Beatable only
            </button>
            <span style={{ color: "var(--gw-muted)", fontSize: "0.85rem" }}>
              Your Strike {formatNaq(strikeAction(player, planets))} · Turns{" "}
              {player.attackTurns} · Covert cap {player.covertCapacity}
            </span>
          </div>
          {visibleEnemies.length === 0 ? (
            <p style={{ color: "var(--gw-muted)" }}>
              No living enemies in this guild
              {beatableOnly ? " that you can currently beat" : ""}.
            </p>
          ) : (
            <table className="gw-table">
              <thead>
                <tr>
                  <th>Commander</th>
                  <th>Race</th>
                  <th>Score</th>
                  <th>Open Naq</th>
                  <th>Est. Defence</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleEnemies.map(
                  ({
                    realm,
                    score,
                    def,
                    beatable,
                    clustered,
                    clusterSize,
                    inRankRange,
                  }) => (
                  <tr
                    key={realm.id}
                    style={beatable ? undefined : { opacity: 0.55 }}
                  >
                    <td>
                      <RealmLink realmId={realm.id}>{realm.name}</RealmLink>
                      {!inRankRange ? (
                        <span
                          style={{
                            marginLeft: 6,
                            color: "var(--gw-muted)",
                            fontSize: "0.75rem",
                          }}
                          title="More than 10% below your rank"
                        >
                          out of range
                        </span>
                      ) : null}
                      {clustered ? (
                        <span
                          style={{
                            marginLeft: 6,
                            color: "var(--gw-muted)",
                            fontSize: "0.75rem",
                          }}
                        >
                          ✦{clusterSize}
                        </span>
                      ) : null}
                    </td>
                    <td>{realm.ascendedTitle ?? RACES[realm.race].name}</td>
                    <td title={formatNaqExact(score)}>{formatNaq(score)}</td>
                    <td title={formatNaqExact(realm.naquadah)}>
                      {formatNaq(realm.naquadah)}
                    </td>
                    <td title={formatNaqExact(def)}>{formatNaq(def)}</td>
                    <td>
                      <button
                        type="button"
                        className="gw-btn gw-btn-ghost"
                        onClick={() => {
                          setSelectedTargetId(realm.id);
                          setMsg(null);
                        }}
                      >
                        Target
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {target && selectedWar && (
        <div className="gw-card">
          <h2>
            Engage{" "}
            <RealmLink realmId={target.id}>{target.name}</RealmLink>
            <span style={{ color: "var(--gw-muted)", fontWeight: 400 }}>
              {" "}
              · wartime target
            </span>
          </h2>
          <p className="gw-lead" style={{ marginBottom: "0.75rem" }}>
            Your Strike {formatNaq(strikeAction(player, planets))} vs their
            Defence {formatNaq(effectiveDefencePotential(target, planets, save))}
            . War: {enemyGuildLabel(selectedWar, player.allianceId)}.
            {!targetInRankRange
              ? ` Out of rank range (you #${overallRankOf(save, player.id)}, they #${overallRankOf(save, target.id)}, max #${maxAttackableRankFor(save, player.id)}).`
              : ""}
            {(() => {
              const ratio = eradicationPowerRatio(player, target, planets, save);
              const chance = eradicationChance(ratio);
              if (chance <= 0 || !targetInRankRange) return null;
              return (
                <>
                  {" "}
                  Eradication:{" "}
                  <span style={{ color: "var(--gw-danger, #e85d4c)" }}>
                    {(chance * 100).toFixed(0)}%
                  </span>{" "}
                  at {ratio.toFixed(0)}×.
                </>
              );
            })()}
          </p>
          {battleLog && battleLog.defenderId === target.id && (
            <BattleScene
              attackerRace={player.race}
              defenderRace={target.race}
              attackerAscension={player.ascensionLevel ?? 0}
              defenderAscension={target.ascensionLevel ?? 0}
              log={battleLog}
            />
          )}
          <div className="gw-row">
            <div className="gw-field">
              <label htmlFor="wturns">Attack turns</label>
              <input
                id="wturns"
                className="gw-input"
                type="number"
                min={1}
                max={15}
                value={turns}
                onChange={(e) => setTurns(Number(e.target.value))}
              />
            </div>
            <div className="gw-field">
              <label htmlFor="wagents">Agents</label>
              <input
                id="wagents"
                className="gw-input"
                type="number"
                min={1}
                max={Math.max(1, player.units.covert)}
                value={agents}
                onChange={(e) => setAgents(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="gw-row" style={{ marginTop: "0.85rem" }}>
            <button
              type="button"
              className="gw-btn"
              disabled={!targetInRankRange}
              title={
                targetInRankRange
                  ? undefined
                  : "Target is more than 10% below your rank"
              }
              onClick={() => report(attack(target.id, turns, "attack"))}
            >
              Attack
            </button>
            <button
              type="button"
              className="gw-btn"
              disabled={!targetInRankRange}
              title={
                targetInRankRange
                  ? undefined
                  : "Target is more than 10% below your rank"
              }
              onClick={() => report(attack(target.id, turns, "raid"))}
            >
              Raid
            </button>
            <button
              type="button"
              className="gw-btn gw-btn-danger"
              disabled={
                !targetInRankRange ||
                eradicationChance(
                  eradicationPowerRatio(player, target, planets, save),
                ) <= 0 ||
                player.attackTurns < ERADICATION_TURN_COST
              }
              onClick={() => report(eradicate(target.id))}
            >
              Eradicate (
              {(
                eradicationChance(
                  eradicationPowerRatio(player, target, planets, save),
                ) * 100
              ).toFixed(0)}
              %)
            </button>
            <button
              type="button"
              className="gw-btn gw-btn-ghost"
              onClick={() => report(spy(target.id, agents))}
            >
              Spy
            </button>
            <button
              type="button"
              className="gw-btn gw-btn-ghost"
              onClick={() => report(sabotage(target.id, agents))}
            >
              Sabotage
            </button>
            <button
              type="button"
              className="gw-btn gw-btn-danger"
              onClick={() => report(assassinate(target.id, agents))}
            >
              Assassinate
            </button>
          </div>
          {msg && (
            <div className={`gw-msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>
          )}
        </div>
      )}
    </>
  );
}
