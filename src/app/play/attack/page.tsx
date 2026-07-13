"use client";

import { useMemo, useState } from "react";
import { PlayGate } from "@/components/PlayGate";
import { useGame } from "@/lib/game/GameContext";
import { RACES } from "@/lib/game/races";
import {
  defenceAction,
  formatNaq,
  formatNaqExact,
  overallRankScore,
  strikeAction,
} from "@/lib/game/economy";
import {
  effectiveDefencePotential,
  getClusterForRealm,
} from "@/lib/game/fleetClusters";
import {
  isBelowAttackRankRange,
  maxAttackableRankFor,
  overallRankOf,
} from "@/lib/game/rankings";
import type { AttackLogEntry, IntelLogEntry } from "@/lib/db/schema";
import {
  FACTIONS,
  factionOf,
  getAlliance,
  sameAlliance,
  sameFaction,
} from "@/lib/game/guilds";
import { areGuildsAtWar, eradicationChance, eradicationPowerRatio, ERADICATION_TURN_COST } from "@/lib/game/wars";
import { RealmLink } from "@/components/RealmLink";
import { GuildLink } from "@/components/GuildLink";
import { BattleScene } from "@/components/BattleScene";
import { intelVisibility, maskValue } from "@/lib/game/intelVisibility";

const PAGE_SIZE = 40;

export default function AttackPage() {
  return (
    <PlayGate stageMode="battle">
      <AttackView />
    </PlayGate>
  );
}

function AttackView() {
  const { save, player, attack, eradicate, spy, sabotage, assassinate } = useGame();
  const [turns, setTurns] = useState(5);
  const [agents, setAgents] = useState(3);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [beatableOnly, setBeatableOnly] = useState(true);
  const [richOnly, setRichOnly] = useState(false);
  const [battleLog, setBattleLog] = useState<AttackLogEntry | null>(null);

  const ranked = useMemo(() => {
    if (!save || !player) return [];
    const planets = save.planets ?? [];
    const myStrike = strikeAction(player, planets);
    const cache = save.rankingsCache;
    const order = cache?.order.overall;
    const byId = cache?.byId;
    const realmById = new Map(save.realms.map((r) => [r.id, r] as const));

    const list = order?.length
      ? order
          .map((id) => realmById.get(id))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
      : save.realms;

    return list
      .filter((r) => {
        if (r.id === player.id || r.vacation || r.dead) return false;
        if (sameAlliance(player, r)) return false;
        if (sameFaction(player, r) && !areGuildsAtWar(save, player, r)) {
          return false;
        }
        return true;
      })
      .map((r) => {
        const snap = byId?.[r.id];
        const def = effectiveDefencePotential(r, planets, save);
        const soloDef = snap?.defence ?? defenceAction(r, planets);
        const cluster = getClusterForRealm(save, r.id);
        const guild = getAlliance(save, r.allianceId);
        const inRankRange = !isBelowAttackRankRange(save, player.id, r.id);
        return {
          realm: r,
          score: snap?.overall ?? overallRankScore(r, planets),
          def,
          soloDef,
          clustered: !!(cluster && cluster.memberIds.length > 1),
          clusterSize: cluster?.memberIds.length ?? 0,
          inRankRange,
          beatable: inRankRange && myStrike > def,
          guildId: guild?.id ?? null,
          guildTag: guild ? guild.tag : null,
          guildName: guild ? guild.name : null,
          factionId: factionOf(r),
        };
      });
    // Cache order is already overall-sorted; keep that order
  }, [save, player]);

  const filtered = useMemo(() => {
    let list = ranked;
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.realm.name.toLowerCase().includes(q) ||
          (r.guildTag ?? "").toLowerCase().includes(q) ||
          (r.guildName ?? "").toLowerCase().includes(q) ||
          FACTIONS[r.factionId].name.toLowerCase().includes(q),
      );
    }
    if (beatableOnly) list = list.filter((r) => r.beatable);
    if (richOnly) list = list.filter((r) => r.realm.naquadah >= 1000);
    return list;
  }, [ranked, query, beatableOnly, richOnly]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount - 1);
  const slice = filtered.slice(
    pageSafe * PAGE_SIZE,
    pageSafe * PAGE_SIZE + PAGE_SIZE,
  );

  if (!player || !save) return null;
  const planets = save.planets ?? [];
  const selectedRow = ranked.find((r) => r.realm.id === selected);
  const target =
    selectedRow?.realm ?? save.realms.find((r) => r.id === selected);
  const targetGuild = target ? getAlliance(save, target.allianceId) : null;
  const targetFaction = target ? factionOf(target) : "unaligned";
  const targetInRankRange = target
    ? !isBelowAttackRankRange(save, player.id, target.id)
    : false;

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
      <h1 className="gw-title">Attack</h1>
      <p className="gw-lead">
        {ranked.length} live targets among {save.realms.length - 1} AI rivals.
        You can only attack down to #
        {maxAttackableRankFor(save, player.id)} (within 10% of the living
        ladder from your rank #{overallRankOf(save, player.id)}). Same guild /
        faction are hidden.
      </p>

      <div className="gw-card">
        <h2>Targets</h2>
        <div className="gw-row" style={{ marginBottom: "0.75rem" }}>
          <div className="gw-field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="tq">Search</label>
            <input
              id="tq"
              className="gw-input"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder="Commander name…"
            />
          </div>
          <button
            type="button"
            className={`gw-btn ${beatableOnly ? "" : "gw-btn-ghost"}`}
            onClick={() => {
              setBeatableOnly((v) => !v);
              setPage(0);
            }}
          >
            Beatable only
          </button>
          <button
            type="button"
            className={`gw-btn ${richOnly ? "" : "gw-btn-ghost"}`}
            onClick={() => {
              setRichOnly((v) => !v);
              setPage(0);
            }}
          >
            Rich (1k+ Naq)
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="gw-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Guild</th>
                <th>Faction</th>
                <th>Race</th>
                <th>Score</th>
                <th>Open Naq</th>
                <th>Est. Defence</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {slice.map(
                ({
                  realm,
                  score,
                  def,
                  clustered,
                  clusterSize,
                  beatable,
                  inRankRange,
                  guildId,
                  guildTag,
                  guildName,
                  factionId,
                }) => {
                const vis = intelVisibility(player, realm);
                return (
                <tr
                  key={realm.id}
                  style={
                    beatable
                      ? undefined
                      : { opacity: 0.55 }
                  }
                >
                  <td>
                    <RealmLink realmId={realm.id}>{realm.name}</RealmLink>
                    {clustered ? (
                      <span
                        style={{
                          marginLeft: 6,
                          color: "var(--gw-muted)",
                          fontSize: "0.75rem",
                        }}
                        title={`Fleet cluster (${clusterSize})`}
                      >
                        ✦{clusterSize}
                      </span>
                    ) : null}
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
                  </td>
                  <td title={guildName ?? "No guild"}>
                    {guildTag && guildId ? (
                      <GuildLink allianceId={guildId}>[{guildTag}]</GuildLink>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={{ color: FACTIONS[factionId].color }}>
                    {FACTIONS[factionId].name}
                  </td>
                  <td>{RACES[realm.race].name}</td>
                  <td>{maskValue(vis.seeScore, score, "naq")}</td>
                  <td>{maskValue(vis.seeNaquadah, realm.naquadah, "naq")}</td>
                  <td>
                    {maskValue(vis.seeCombat, def, "naq")}
                    {clustered && vis.seeCombat ? (
                      <span
                        style={{
                          display: "block",
                          fontSize: "0.7rem",
                          color: "var(--gw-muted)",
                        }}
                      >
                        clustered
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="gw-btn gw-btn-ghost"
                      onClick={() => setSelected(realm.id)}
                    >
                      Engage
                    </button>
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
        <div className="gw-row" style={{ marginTop: "0.75rem" }}>
          <button
            type="button"
            className="gw-btn gw-btn-ghost"
            disabled={pageSafe <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Prev
          </button>
          <span style={{ color: "var(--gw-muted)", fontSize: "0.85rem" }}>
            Page {pageSafe + 1} / {pageCount} · {filtered.length} targets
          </span>
          <button
            type="button"
            className="gw-btn gw-btn-ghost"
            disabled={pageSafe >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            Next
          </button>
        </div>
      </div>

      {target && (
        <div className="gw-card">
          <h2>
            Engage{" "}
            <RealmLink realmId={target.id}>{target.name}</RealmLink>{" "}
            <span style={{ color: "var(--gw-muted)", fontWeight: 400 }}>
              ({RACES[target.race].name}
              {targetGuild ? (
                <>
                  {" · "}
                  <GuildLink allianceId={targetGuild.id}>
                    [{targetGuild.tag}] {targetGuild.name}
                  </GuildLink>
                </>
              ) : (
                ""
              )}
              {" · "}
              <span style={{ color: FACTIONS[targetFaction].color }}>
                {FACTIONS[targetFaction].name}
              </span>
              )
            </span>
          </h2>
          {battleLog &&
            (battleLog.defenderId === target.id ||
              battleLog.attackerId === player.id) && (
              <BattleScene
                attackerRace={player.race}
                defenderRace={
                  save.realms.find((r) => r.id === battleLog.defenderId)
                    ?.race ?? target.race
                }
                attackerAscension={player.ascensionLevel ?? 0}
                defenderAscension={
                  save.realms.find((r) => r.id === battleLog.defenderId)
                    ?.ascensionLevel ??
                  target.ascensionLevel ??
                  0
                }
                log={battleLog}
              />
            )}
          <p className="gw-lead" style={{ marginBottom: "0.75rem" }}>
            Your Strike{" "}
            <span title={formatNaqExact(strikeAction(player, planets))}>
              {formatNaq(strikeAction(player, planets))}
            </span>{" "}
            vs their Defence{" "}
            <span>
              {maskValue(
                intelVisibility(player, target).seeCombat,
                effectiveDefencePotential(target, planets, save),
                "naq",
              )}
            </span>
            {(() => {
              const c = getClusterForRealm(save, target.id);
              if (!c || c.memberIds.length < 2) return null;
              return ` (fleet cluster ×${c.memberIds.length})`;
            })()}
            . Vacation: {target.vacation ? "yes" : "no"}.
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
                  at {ratio.toFixed(0)}× power (5% per 10×).
                </>
              );
            })()}
          </p>
          <div className="gw-row">
            <div className="gw-field">
              <label htmlFor="turns">Attack turns</label>
              <input
                id="turns"
                className="gw-input"
                type="number"
                min={1}
                max={15}
                value={turns}
                onChange={(e) => setTurns(Number(e.target.value))}
              />
            </div>
            <div className="gw-field">
              <label htmlFor="agents">Agents to send</label>
              <input
                id="agents"
                className="gw-input"
                type="number"
                min={1}
                max={player.units.covert}
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
              Raid (steal UU)
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
              title={
                !targetInRankRange
                  ? "Target is more than 10% below your rank"
                  : eradicationChance(
                        eradicationPowerRatio(player, target, planets, save),
                      ) <= 0
                    ? "Need at least 10× their defence"
                    : `Spend ${ERADICATION_TURN_COST} turns — ${(eradicationChance(eradicationPowerRatio(player, target, planets, save)) * 100).toFixed(0)}% wipe`
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
