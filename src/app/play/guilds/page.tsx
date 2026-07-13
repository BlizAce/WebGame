"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PlayGate } from "@/components/PlayGate";
import { useGame } from "@/lib/game/GameContext";
import { formatNaq } from "@/lib/game/economy";
import {
  ALLIANCE_CREATE_COST,
  FACTION_LIST,
  FACTIONS,
  allianceMembers,
  buildGuildRankings,
  ensureGuildFund,
  ensureGuildTech,
  factionOf,
  getAlliance,
  GUILD_FUND_DIVIDEND_RATE,
  guildFundDividendPerMember,
  guildMiningMult,
  guildTechUpgradeCost,
  guildTotalPower,
  guildUpBonus,
} from "@/lib/game/guilds";
import {
  FLEET_CLUSTER_MAX,
  clusterDefenceBreakdown,
  getClusterForGuild,
  getClusterForRealm,
} from "@/lib/game/fleetClusters";
import { activeWars } from "@/lib/game/wars";
import type { FactionId } from "@/lib/db/schema";
import { RACES } from "@/lib/game/races";
import { RealmLink } from "@/components/RealmLink";
import { GuildLink } from "@/components/GuildLink";

export default function GuildsPage() {
  return (
    <PlayGate stageMode="guild">
      <Guilds />
    </PlayGate>
  );
}

function Guilds() {
  const {
    save,
    player,
    createGuild,
    joinGuild,
    leaveGuild,
    startFleetCluster,
    joinFleetCluster,
    leaveFleetCluster,
    kickFromFleetCluster,
    dissolveFleetCluster,
    upgradeGuildTechBranch,
    depositGuildFund,
    withdrawGuildFund,
    declareWar,
    endWar,
    setFaction,
  } = useGame();
  const [name, setName] = useState("My Pact");
  const [msg, setMsg] = useState<string | null>(null);
  const [fundAmt, setFundAmt] = useState(1000);

  const alliances = useMemo(() => {
    if (!save) return [];
    return buildGuildRankings(save);
  }, [save, save?.rankingsCache?.refreshedAt]);

  const wars = useMemo(() => {
    if (!save) return [];
    return activeWars(save);
  }, [save]);

  if (!player || !save) return null;

  const mine = getAlliance(save, player.allianceId);
  const myFaction = factionOf(player);
  const planets = save.planets ?? [];
  const tech = mine ? ensureGuildTech(mine) : null;
  const fund = mine ? ensureGuildFund(mine) : 0;
  const fundDiv = mine ? guildFundDividendPerMember(save, mine) : 0;
  const upCost = tech ? guildTechUpgradeCost("up", tech.up) : 0;
  const miningCost = tech ? guildTechUpgradeCost("mining", tech.mining) : 0;
  const upBonus = guildUpBonus(player, save);
  const miningPct = Math.round((guildMiningMult(player, save) - 1) * 100);
  const myPower = mine ? guildTotalPower(save, mine) : 0;
  const myGuildRank =
    mine != null
      ? alliances.find((g) => g.alliance.id === mine.id)?.rank ?? null
      : null;
  const isLeader = !!(mine && mine.leaderId === player.id);
  const memberList = mine
    ? allianceMembers(save, mine).sort((a, b) => {
        const byId = save.rankingsCache?.byId;
        const sa = byId?.[a.id]?.overall ?? 0;
        const sb = byId?.[b.id]?.overall ?? 0;
        return sb - sa;
      })
    : [];

  return (
    <>
      <h1 className="gw-title">Guilds & Factions</h1>
      <p className="gw-lead">
        Guilds grant combat/income bonuses from membership size. Shared guild
        tech (UP &amp; Mining) benefits every member — any member can fund the
        next level. Factions are broad blocs — allies in the same faction
        won&apos;t attack each other.
      </p>

      <div className="gw-card">
        <h2>Your standing</h2>
        <div className="gw-stats">
          <div className="gw-stat">
            <span>Faction</span>
            <strong style={{ color: FACTIONS[myFaction].color }}>
              {FACTIONS[myFaction].name}
            </strong>
          </div>
          <div className="gw-stat">
            <span>Guild</span>
            <strong>
              {mine ? (
                <GuildLink allianceId={mine.id}>
                  [{mine.tag}] {mine.name}
                </GuildLink>
              ) : (
                "None"
              )}
            </strong>
          </div>
          <div className="gw-stat">
            <span>Members</span>
            <strong>{mine ? mine.memberIds.length : "—"}</strong>
          </div>
          <div className="gw-stat">
            <span>Guild power</span>
            <strong>{mine ? formatNaq(myPower) : "—"}</strong>
          </div>
          <div className="gw-stat">
            <span>Guild rank</span>
            <strong>{myGuildRank != null ? `#${myGuildRank}` : "—"}</strong>
          </div>
          {mine && (
            <div className="gw-stat">
              <span>Guild fund</span>
              <strong>{formatNaq(fund)}</strong>
            </div>
          )}
        </div>
        {!mine && (
          <div className="gw-row" style={{ marginTop: "0.85rem" }}>
            {FACTION_LIST.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`gw-btn ${myFaction === f.id ? "" : "gw-btn-ghost"}`}
                onClick={() =>
                  setMsg(setFaction(f.id as FactionId) ?? `Joined ${f.name}`)
                }
              >
                {f.name}
              </button>
            ))}
          </div>
        )}
        <p style={{ color: "var(--gw-muted)", fontSize: "0.85rem" }}>
          {FACTIONS[myFaction].blurb}
        </p>
      </div>

      <div className="gw-card">
        <h2>{mine ? "Your guild" : "Found a guild"}</h2>
        {mine && tech ? (
          <>
            <p style={{ color: "var(--gw-muted)" }}>
              Leader:{" "}
              <RealmLink realmId={mine.leaderId}>
                {save.realms.find((r) => r.id === mine.leaderId)?.name ?? "?"}
              </RealmLink>{" "}
              · Faction: {FACTIONS[mine.factionId].name}
            </p>

            <h3 style={{ marginTop: "1rem", fontSize: "1rem" }}>
              Guild fund
            </h3>
            <p style={{ color: "var(--gw-muted)", fontSize: "0.85rem" }}>
              Any member can deposit or withdraw freely. Each turn the fund pays
              a {(GUILD_FUND_DIVIDEND_RATE * 100).toFixed(1)}% dividend, split
              equally among living members (taken from the fund).
            </p>
            <div className="gw-stats" style={{ marginBottom: "0.75rem" }}>
              <div className="gw-stat">
                <span>Fund balance</span>
                <strong>{formatNaq(fund)}</strong>
              </div>
              <div className="gw-stat">
                <span>Your dividend / turn</span>
                <strong>+{formatNaq(fundDiv)} Naq</strong>
              </div>
            </div>
            <div className="gw-row" style={{ marginBottom: "1rem" }}>
              <div className="gw-field">
                <label htmlFor="gfund">Amount</label>
                <input
                  id="gfund"
                  className="gw-input"
                  type="number"
                  min={1}
                  value={fundAmt}
                  onChange={(e) => setFundAmt(Number(e.target.value))}
                />
              </div>
              <button
                type="button"
                className="gw-btn"
                disabled={fundAmt < 1 || player.naquadah < fundAmt}
                onClick={() =>
                  setMsg(
                    depositGuildFund(fundAmt) ??
                      `Deposited ${formatNaq(fundAmt)} Naq`,
                  )
                }
              >
                Deposit
              </button>
              <button
                type="button"
                className="gw-btn gw-btn-ghost"
                disabled={fundAmt < 1 || fund < fundAmt}
                onClick={() =>
                  setMsg(
                    withdrawGuildFund(fundAmt) ??
                      `Withdrew ${formatNaq(fundAmt)} Naq`,
                  )
                }
              >
                Withdraw
              </button>
            </div>

            <h3 style={{ marginTop: "1rem", fontSize: "1rem" }}>
              Shared guild tech
            </h3>
            <p style={{ color: "var(--gw-muted)", fontSize: "0.85rem" }}>
              Any member can contribute Naq. Bonuses apply to every member each
              turn.
            </p>
            <div className="gw-stats" style={{ marginBottom: "0.75rem" }}>
              <div className="gw-stat">
                <span>Total guild power</span>
                <strong>{formatNaq(myPower)}</strong>
              </div>
              <div className="gw-stat">
                <span>Guild UP Lv {tech.up}</span>
                <strong>+{upBonus} UU/turn</strong>
              </div>
              <div className="gw-stat">
                <span>Guild Mining Lv {tech.mining}</span>
                <strong>+{miningPct}% Naq income</strong>
              </div>
            </div>
            <div className="gw-row" style={{ marginBottom: "1rem" }}>
              <button
                type="button"
                className="gw-btn"
                disabled={player.naquadah < upCost}
                onClick={() =>
                  setMsg(
                    upgradeGuildTechBranch("up") ??
                      `Guild UP → Lv ${tech.up + 1}`,
                  )
                }
              >
                Fund UP ({formatNaq(upCost)} Naq)
              </button>
              <button
                type="button"
                className="gw-btn"
                disabled={player.naquadah < miningCost}
                onClick={() =>
                  setMsg(
                    upgradeGuildTechBranch("mining") ??
                      `Guild Mining → Lv ${tech.mining + 1}`,
                  )
                }
              >
                Fund Mining ({formatNaq(miningCost)} Naq)
              </button>
            </div>

            <h3 style={{ marginTop: "1rem", fontSize: "1rem" }}>
              Fleet cluster
            </h3>
            <p style={{ color: "var(--gw-muted)", fontSize: "0.85rem" }}>
              One cluster per guild (max {FLEET_CLUSTER_MAX}). Attacks against
              any clustered member face the combined defence of the whole
              formation.
            </p>
            {(() => {
              const cluster = getClusterForGuild(save, mine.id);
              const myCluster = getClusterForRealm(save, player.id);
              if (!cluster) {
                return (
                  <div className="gw-row" style={{ marginBottom: "1rem" }}>
                    <button
                      type="button"
                      className="gw-btn"
                      onClick={() =>
                        setMsg(
                          startFleetCluster() ??
                            "Fleet cluster formed — invite guildmates to join",
                        )
                      }
                    >
                      Start fleet cluster
                    </button>
                  </div>
                );
              }
              const breakdown = clusterDefenceBreakdown(
                save,
                player.allianceId === mine.id && myCluster
                  ? player
                  : save.realms.find((r) => r.id === cluster.memberIds[0]!) ??
                      player,
                planets,
              );
              const isLeader = cluster.leaderId === player.id;
              const inCluster = !!myCluster;
              return (
                <div style={{ marginBottom: "1rem" }}>
                  <div className="gw-stats" style={{ marginBottom: "0.75rem" }}>
                    <div className="gw-stat">
                      <span>Members</span>
                      <strong>
                        {cluster.memberIds.length}/{FLEET_CLUSTER_MAX}
                      </strong>
                    </div>
                    <div className="gw-stat">
                      <span>Combined defence</span>
                      <strong>{formatNaq(breakdown.total)}</strong>
                    </div>
                    <div className="gw-stat">
                      <span>Cluster leader</span>
                      <strong>
                        <RealmLink realmId={cluster.leaderId}>
                          {save.realms.find((r) => r.id === cluster.leaderId)
                            ?.name ?? "?"}
                        </RealmLink>
                      </strong>
                    </div>
                  </div>
                  <ul
                    style={{
                      margin: "0 0 0.75rem",
                      paddingLeft: "1.1rem",
                      color: "var(--gw-muted)",
                      fontSize: "0.85rem",
                    }}
                  >
                    {cluster.memberIds.map((id) => {
                      const m = save.realms.find((r) => r.id === id);
                      if (!m) return null;
                      return (
                        <li key={id}>
                          <RealmLink realmId={id}>{m.name}</RealmLink>
                          {id === cluster.leaderId ? " ★" : ""}
                          {id === player.id ? " (you)" : ""}
                          {isLeader && id !== player.id ? (
                            <>
                              {" "}
                              <button
                                type="button"
                                className="gw-btn gw-btn-ghost"
                                style={{
                                  padding: "0.1rem 0.4rem",
                                  fontSize: "0.75rem",
                                }}
                                onClick={() =>
                                  setMsg(
                                    kickFromFleetCluster(id) ??
                                      `Kicked ${m.name}`,
                                  )
                                }
                              >
                                Kick
                              </button>
                            </>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                  <div className="gw-row">
                    {!inCluster &&
                      cluster.memberIds.length < FLEET_CLUSTER_MAX && (
                        <button
                          type="button"
                          className="gw-btn"
                          onClick={() =>
                            setMsg(
                              joinFleetCluster(cluster.id) ??
                                "Joined fleet cluster",
                            )
                          }
                        >
                          Join cluster
                        </button>
                      )}
                    {inCluster && (
                      <button
                        type="button"
                        className="gw-btn gw-btn-ghost"
                        onClick={() =>
                          setMsg(leaveFleetCluster() ?? "Left fleet cluster")
                        }
                      >
                        Leave cluster
                      </button>
                    )}
                    {isLeader && (
                      <button
                        type="button"
                        className="gw-btn gw-btn-danger"
                        onClick={() =>
                          setMsg(
                            dissolveFleetCluster() ?? "Fleet cluster dissolved",
                          )
                        }
                      >
                        Dissolve cluster
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            <table className="gw-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Race</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {memberList.slice(0, 40).map((m) => (
                    <tr key={m.id}>
                      <td>
                        <RealmLink realmId={m.id}>
                          {m.name}
                          {m.id === player.id ? " (you)" : ""}
                          {m.id === mine.leaderId ? " ★" : ""}
                        </RealmLink>
                      </td>
                      <td>{m.ascendedTitle ?? RACES[m.race].name}</td>
                      <td>
                        {formatNaq(
                          save.rankingsCache?.byId[m.id]?.overall ?? 0,
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {mine.news[0] && (
              <p style={{ color: "var(--gw-muted)", fontSize: "0.85rem" }}>
                Latest: {mine.news[0]}
              </p>
            )}
            <button
              type="button"
              className="gw-btn gw-btn-danger"
              onClick={() => setMsg(leaveGuild() ?? "Left guild")}
            >
              Leave guild
            </button>
          </>
        ) : (
          <>
            <p style={{ color: "var(--gw-muted)" }}>
              Costs {formatNaq(ALLIANCE_CREATE_COST)} Naq. You become leader and
              set the guild&apos;s faction.
            </p>
            <div className="gw-row">
              <div className="gw-field" style={{ flex: 1 }}>
                <label htmlFor="gname">Guild name</label>
                <input
                  id="gname"
                  className="gw-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={32}
                />
              </div>
              <button
                type="button"
                className="gw-btn"
                onClick={() =>
                  setMsg(createGuild(name) ?? `Founded ${name}`)
                }
              >
                Found guild
              </button>
            </div>
          </>
        )}
      </div>

      <div className="gw-card">
        <h2>Active guild wars ({wars.length})</h2>
        <div className="gw-tips">
          <h3>War tips</h3>
          <ul>
            <li>
              Leaders declare war from the rankings table, and can <strong>End war</strong>{" "}
              to sue for peace.
            </li>
            <li>
              Use the{" "}
              <Link href="/play/war-room" style={{ color: "var(--race-glow)" }}>
                War Room
              </Link>{" "}
              to focus fire on enemy guild members.
            </li>
            <li>
              <strong>Eradicate:</strong> at ≥10× strike vs their defence, winning
              attacks roll a wipe (5% per 10× tier: 10×→5%, 20×→10%, …). Or spend
              10 turns on Eradicate. AI die permanently (replacement spawns);
              players are soft-wiped.
            </li>
          </ul>
        </div>
        {wars.length === 0 ? (
          <p style={{ color: "var(--gw-muted)" }}>
            No wars declared. Guild leaders can declare war from the rankings
            table.
          </p>
        ) : (
          <table className="gw-table">
            <thead>
              <tr>
                <th>Attacker</th>
                <th>Defender</th>
                <th>Declared by</th>
                <th>Kills</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {wars.map((w) => {
                const involved =
                  !!mine &&
                  (w.attackerAllianceId === mine.id ||
                    w.defenderAllianceId === mine.id);
                return (
                  <tr key={w.id}>
                    <td>
                      <GuildLink allianceId={w.attackerAllianceId}>
                        [{w.attackerTag}] {w.attackerName}
                      </GuildLink>
                    </td>
                    <td>
                      <GuildLink allianceId={w.defenderAllianceId}>
                        [{w.defenderTag}] {w.defenderName}
                      </GuildLink>
                    </td>
                    <td>
                      <RealmLink realmId={w.declaredById}>
                        {w.declaredByName}
                      </RealmLink>
                    </td>
                    <td>
                      {w.killsAttacker} : {w.killsDefender}
                    </td>
                    <td>
                      {isLeader && involved ? (
                        <button
                          type="button"
                          className="gw-btn gw-btn-ghost"
                          onClick={() => {
                            const err = endWar(w.id);
                            setMsg(err ?? "War ended — peace declared.");
                          }}
                        >
                          End war
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="gw-card">
        <h2>Guild rankings ({alliances.length})</h2>
        {alliances.length === 0 ? (
          <p style={{ color: "var(--gw-muted)" }}>
            No guilds yet — pulse the AI and they will start founding them.
          </p>
        ) : (
          <table className="gw-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Tag</th>
                <th>Name</th>
                <th>Faction</th>
                <th>Members</th>
                <th>Total power</th>
                <th>Tech</th>
                <th>Mode</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {alliances.slice(0, 80).map((row) => {
                const a = row.alliance;
                const mineRow = a.id === player.allianceId;
                return (
                  <tr
                    key={a.id}
                    style={
                      mineRow
                        ? {
                            background:
                              "color-mix(in oklab, var(--race-primary) 18%, transparent)",
                          }
                        : undefined
                    }
                  >
                    <td>{row.rank}</td>
                    <td>[{a.tag}]</td>
                    <td>
                      <GuildLink allianceId={a.id}>
                        {a.name}
                        {mineRow ? " (yours)" : ""}
                      </GuildLink>
                    </td>
                    <td style={{ color: FACTIONS[a.factionId].color }}>
                      {FACTIONS[a.factionId].name}
                    </td>
                    <td>{row.members}</td>
                    <td>{formatNaq(row.power)}</td>
                    <td>
                      UP {row.techUp} · Mine {row.techMining}
                    </td>
                    <td>{a.joinMode}</td>
                    <td>
                      {!player.allianceId && a.joinMode !== "closed" && (
                        <button
                          type="button"
                          className="gw-btn gw-btn-ghost"
                          onClick={() =>
                            setMsg(joinGuild(a.id) ?? `Joined ${a.name}`)
                          }
                        >
                          Join
                        </button>
                      )}
                      {isLeader &&
                        !mineRow &&
                        !wars.some(
                          (w) =>
                            (w.attackerAllianceId === mine?.id &&
                              w.defenderAllianceId === a.id) ||
                            (w.defenderAllianceId === mine?.id &&
                              w.attackerAllianceId === a.id),
                        ) && (
                          <button
                            type="button"
                            className="gw-btn gw-btn-danger"
                            onClick={() =>
                              setMsg(
                                declareWar(a.id) ??
                                  `War declared on [${a.tag}]`,
                              )
                            }
                          >
                            Declare war
                          </button>
                        )}
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
