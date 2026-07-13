"use client";

import { useMemo, useState } from "react";
import { PlayGate } from "@/components/PlayGate";
import { useGame } from "@/lib/game/GameContext";
import { RACES } from "@/lib/game/races";
import { formatNaq } from "@/lib/game/economy";
import {
  buildRankings,
  gloryPerTurnForRank,
  type RankCategory,
} from "@/lib/game/rankings";
import {
  FACTIONS,
  buildGuildRankings,
  factionOf,
  getAlliance,
} from "@/lib/game/guilds";
import { RealmLink } from "@/components/RealmLink";
import { GuildLink } from "@/components/GuildLink";
import {
  maskValue,
  intelVisibility,
} from "@/lib/game/intelVisibility";

type BoardMode = "commanders" | "guilds";

const TABS: { id: RankCategory; label: string }[] = [
  { id: "overall", label: "Overall" },
  { id: "strike", label: "Strike" },
  { id: "defence", label: "Defence" },
  { id: "covert", label: "Covert" },
  { id: "antiCovert", label: "Anti-Covert" },
  { id: "mothership", label: "Mothership" },
  { id: "glory", label: "G&R" },
];

const PAGE_SIZE = 50;

export default function RankingsPage() {
  return (
    <PlayGate stageMode="rankings">
      <Rankings />
    </PlayGate>
  );
}

function Rankings() {
  const { save, player } = useGame();
  const [board, setBoard] = useState<BoardMode>("commanders");
  const [tab, setTab] = useState<RankCategory>("overall");
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [nearMe, setNearMe] = useState(false);

  const rows = useMemo(() => {
    if (!save) return [];
    return buildRankings(save, tab);
  }, [save, tab, save?.rankingsCache?.refreshedAt]);

  const guildRows = useMemo(() => {
    if (!save) return [];
    return buildGuildRankings(save);
  }, [save, save?.rankingsCache?.refreshedAt]);

  const myRank = useMemo(
    () => rows.find((r) => r.realm.id === player?.id)?.rank ?? 1,
    [rows, player],
  );

  const myGuildRank = useMemo(() => {
    if (!player?.allianceId) return null;
    return guildRows.find((g) => g.alliance.id === player.allianceId)?.rank ?? null;
  }, [guildRows, player]);

  const filtered = useMemo(() => {
    let list = rows;
    const q = query.trim().toLowerCase();
    if (q && save) {
      list = list.filter((r) => {
        const guild = getAlliance(save, r.realm.allianceId);
        const faction = FACTIONS[factionOf(r.realm)].name;
        return (
          r.realm.name.toLowerCase().includes(q) ||
          RACES[r.realm.race].name.toLowerCase().includes(q) ||
          (r.realm.ascendedTitle ?? "").toLowerCase().includes(q) ||
          (guild?.tag ?? "").toLowerCase().includes(q) ||
          (guild?.name ?? "").toLowerCase().includes(q) ||
          faction.toLowerCase().includes(q)
        );
      });
    }
    if (nearMe && player) {
      list = list.filter((r) => Math.abs(r.rank - myRank) <= 25);
    }
    return list;
  }, [rows, query, nearMe, player, myRank, save]);

  const filteredGuilds = useMemo(() => {
    let list = guildRows;
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (g) =>
          g.alliance.name.toLowerCase().includes(q) ||
          g.alliance.tag.toLowerCase().includes(q) ||
          FACTIONS[g.alliance.factionId].name.toLowerCase().includes(q) ||
          g.leaderName.toLowerCase().includes(q),
      );
    }
    return list;
  }, [guildRows, query]);

  const activeList = board === "guilds" ? filteredGuilds : filtered;
  const pageCount = Math.max(1, Math.ceil(activeList.length / PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount - 1);
  const sliceStart = pageSafe * PAGE_SIZE;
  const commanderSlice = filtered.slice(sliceStart, sliceStart + PAGE_SIZE);
  const guildSlice = filteredGuilds.slice(sliceStart, sliceStart + PAGE_SIZE);

  if (!save || !player) return null;
  const total = save.realms.length;

  return (
    <>
      <h1 className="gw-title">Rankings</h1>
      <p className="gw-lead">
        {total - 1} AI rivals + you. Overall rank drives Glory & Reputation each
        turn (from the rankings snapshot). Your rank: #{myRank}
        {myGuildRank != null ? ` · Guild rank: #${myGuildRank}` : ""}.
        {!save.rankingsCache
          ? " Snapshot building…"
          : ""}
      </p>

      <div className="gw-card">
        <h2>Leaderboards</h2>
        <div className="gw-row" style={{ marginBottom: "0.85rem" }}>
          <button
            type="button"
            className={`gw-btn ${board === "commanders" ? "" : "gw-btn-ghost"}`}
            onClick={() => {
              setBoard("commanders");
              setPage(0);
            }}
          >
            Commanders
          </button>
          <button
            type="button"
            className={`gw-btn ${board === "guilds" ? "" : "gw-btn-ghost"}`}
            onClick={() => {
              setBoard("guilds");
              setPage(0);
              setNearMe(false);
            }}
          >
            Guilds
          </button>
        </div>

        {board === "commanders" && (
          <div className="gw-row" style={{ marginBottom: "0.85rem" }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`gw-btn ${tab === t.id ? "" : "gw-btn-ghost"}`}
                onClick={() => {
                  setTab(t.id);
                  setPage(0);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        <div className="gw-row" style={{ marginBottom: "0.85rem" }}>
          <div className="gw-field" style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="q">Search</label>
            <input
              id="q"
              className="gw-input"
              value={query}
              placeholder={
                board === "guilds"
                  ? "Guild, tag, faction, leader…"
                  : "Name, guild, faction…"
              }
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </div>
          {board === "commanders" && (
            <>
              <button
                type="button"
                className={`gw-btn ${nearMe ? "" : "gw-btn-ghost"}`}
                onClick={() => {
                  setNearMe((v) => !v);
                  setPage(0);
                }}
              >
                Near my rank
              </button>
              <button
                type="button"
                className="gw-btn gw-btn-ghost"
                onClick={() => {
                  const idx = filtered.findIndex((r) => r.realm.id === player.id);
                  if (idx >= 0) setPage(Math.floor(idx / PAGE_SIZE));
                }}
              >
                Jump to me
              </button>
            </>
          )}
          {board === "guilds" && player.allianceId && (
            <button
              type="button"
              className="gw-btn gw-btn-ghost"
              onClick={() => {
                const idx = filteredGuilds.findIndex(
                  (g) => g.alliance.id === player.allianceId,
                );
                if (idx >= 0) setPage(Math.floor(idx / PAGE_SIZE));
              }}
            >
              Jump to my guild
            </button>
          )}
        </div>

        <div style={{ overflowX: "auto" }}>
          {board === "commanders" ? (
            <table className="gw-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Commander</th>
                  <th>Guild</th>
                  <th>Faction</th>
                  <th>Race</th>
                  <th>Score</th>
                  <th>G&R</th>
                  <th>Asc</th>
                  <th>G&R/turn</th>
                </tr>
              </thead>
              <tbody>
                {commanderSlice.map((row) => {
                  const mine = row.realm.id === player.id;
                  const race = RACES[row.realm.race];
                  const title =
                    row.ascensionLevel > 0 && row.realm.ascendedTitle
                      ? row.realm.ascendedTitle
                      : race.name;
                  const guild = getAlliance(save, row.realm.allianceId);
                  const faction = factionOf(row.realm);
                  const vis = intelVisibility(player, row.realm);
                  return (
                    <tr
                      key={row.realm.id}
                      style={
                        mine
                          ? {
                              background:
                                "color-mix(in oklab, var(--race-primary) 18%, transparent)",
                            }
                          : undefined
                      }
                    >
                      <td>{row.rank}</td>
                      <td>
                        <RealmLink realmId={row.realm.id}>
                          {row.realm.name}
                          {mine ? " (you)" : ""}
                        </RealmLink>
                      </td>
                      <td title={guild?.name ?? "No guild"}>
                        {guild ? (
                          <GuildLink allianceId={guild.id}>
                            [{guild.tag}]
                          </GuildLink>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ color: FACTIONS[faction].color }}>
                        {FACTIONS[faction].name}
                      </td>
                      <td>{title}</td>
                      <td>
                        {maskValue(vis.seeScore, row.categoryScore, "naq")}
                      </td>
                      <td>
                        {maskValue(vis.seeDetails, row.gloryReputation, "naq")}
                      </td>
                      <td>
                        {maskValue(vis.seeDetails, row.ascensionLevel)}
                      </td>
                      <td>+{gloryPerTurnForRank(row.rank, total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : guildSlice.length === 0 ? (
            <p style={{ color: "var(--gw-muted)" }}>
              No guilds yet — found one or pulse the AI.
            </p>
          ) : (
            <table className="gw-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Guild</th>
                  <th>Faction</th>
                  <th>Leader</th>
                  <th>Members</th>
                  <th>Total power</th>
                  <th>Avg power</th>
                  <th>Tech</th>
                </tr>
              </thead>
              <tbody>
                {guildSlice.map((row) => {
                  const mine = row.alliance.id === player.allianceId;
                  return (
                    <tr
                      key={row.alliance.id}
                      style={
                        mine
                          ? {
                              background:
                                "color-mix(in oklab, var(--race-primary) 18%, transparent)",
                            }
                          : undefined
                      }
                    >
                      <td>{row.rank}</td>
                      <td>
                        <GuildLink allianceId={row.alliance.id}>
                          [{row.alliance.tag}] {row.alliance.name}
                          {mine ? " (yours)" : ""}
                        </GuildLink>
                      </td>
                      <td style={{ color: FACTIONS[row.alliance.factionId].color }}>
                        {FACTIONS[row.alliance.factionId].name}
                      </td>
                      <td>
                        <RealmLink realmId={row.alliance.leaderId}>
                          {row.leaderName}
                        </RealmLink>
                      </td>
                      <td>{row.members}</td>
                      <td>{formatNaq(row.power)}</td>
                      <td>{formatNaq(row.avgPower)}</td>
                      <td>
                        UP {row.techUp} · Mine {row.techMining}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="gw-row" style={{ marginTop: "0.85rem" }}>
          <button
            type="button"
            className="gw-btn gw-btn-ghost"
            disabled={pageSafe <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Prev
          </button>
          <span style={{ color: "var(--gw-muted)", fontSize: "0.85rem" }}>
            Page {pageSafe + 1} / {pageCount} · {activeList.length} shown
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
    </>
  );
}
