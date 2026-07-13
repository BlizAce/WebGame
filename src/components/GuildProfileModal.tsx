"use client";

import { useEffect, useMemo } from "react";
import { useGame } from "@/lib/game/GameContext";
import { useProfile } from "@/lib/game/ProfileContext";
import { formatNaq } from "@/lib/game/economy";
import {
  FACTIONS,
  allianceCombatBonus,
  allianceMembers,
  ensureGuildTech,
  getAlliance,
  guildTotalPower,
  ensureGuildFund,
  guildFundDividendPerMember,
} from "@/lib/game/guilds";
import { cachedGuildRank } from "@/lib/game/rankings";
import {
  INTEL_ARMY_RATIO,
  INTEL_COMBAT_RATIO,
  INTEL_DETAIL_RATIO,
  INTEL_NAQ_RATIO,
  intelHint,
  visibleRealmStats,
} from "@/lib/game/intelVisibility";
import { RACES } from "@/lib/game/races";
import { RealmLink } from "@/components/RealmLink";

export function GuildProfileModal() {
  const { activeGuildId, closeGuild, openRealm } = useProfile();
  const { save, player } = useGame();

  const alliance = useMemo(() => {
    if (!save || !activeGuildId) return null;
    return getAlliance(save, activeGuildId) ?? null;
  }, [save, activeGuildId]);

  useEffect(() => {
    if (!activeGuildId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeGuild();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeGuildId, closeGuild]);

  if (!activeGuildId || !save || !player || !alliance) return null;

  const planets = save.planets ?? [];
  const byId = save.rankingsCache?.byId;
  const members = allianceMembers(save, alliance).sort((a, b) => {
    const sa = byId?.[a.id]?.overall ?? 0;
    const sb = byId?.[b.id]?.overall ?? 0;
    return sb - sa;
  });
  const tech = ensureGuildTech(alliance);
  const fund = ensureGuildFund(alliance);
  const power = guildTotalPower(save, alliance);
  const divEach = guildFundDividendPerMember(save, alliance);
  const rank = cachedGuildRank(save, alliance.id);
  const leader = save.realms.find((r) => r.id === alliance.leaderId);
  const mine = player.allianceId === alliance.id;

  return (
    <div
      className="gw-modal-backdrop"
      role="presentation"
      onClick={closeGuild}
    >
      <div
        className="gw-modal gw-modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guild-profile-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gw-modal-head">
          <div>
            <h2 id="guild-profile-title" className="gw-modal-title">
              [{alliance.tag}] {alliance.name}
              {mine ? " (yours)" : ""}
            </h2>
            <p className="gw-modal-sub">
              <span style={{ color: FACTIONS[alliance.factionId].color }}>
                {FACTIONS[alliance.factionId].name}
              </span>
              {" · "}
              {alliance.joinMode}
              {rank != null ? ` · Guild rank #${rank}` : ""}
              {" · "}
              Leader{" "}
              {leader ? (
                <RealmLink realmId={leader.id}>{leader.name}</RealmLink>
              ) : (
                "?"
              )}
            </p>
          </div>
          <button
            type="button"
            className="gw-btn gw-btn-ghost"
            onClick={closeGuild}
            aria-label="Close guild"
          >
            Close
          </button>
        </div>

        <div className="gw-stats" style={{ marginBottom: "0.85rem" }}>
          <div className="gw-stat">
            <span>Members</span>
            <strong>{members.length}</strong>
          </div>
          <div className="gw-stat">
            <span>Total power</span>
            <strong>{formatNaq(power)}</strong>
          </div>
          <div className="gw-stat">
            <span>Guild tech</span>
            <strong>
              UP {tech.up} · Mine {tech.mining}
            </strong>
          </div>
          <div className="gw-stat">
            <span>Guild fund</span>
            <strong>{formatNaq(fund)}</strong>
          </div>
          <div className="gw-stat">
            <span>Div / member</span>
            <strong>+{formatNaq(divEach)}</strong>
          </div>
        </div>

        <p
          style={{
            color: "var(--gw-muted)",
            fontSize: "0.82rem",
            marginTop: 0,
          }}
        >
          Member stats use GateWars intel rules: Naq at ≥
          {Math.round(INTEL_NAQ_RATIO * 100)}% their Covert, army at ≥
          {Math.round(INTEL_ARMY_RATIO * 100)}%, strike/defence at ≥
          {Math.round(INTEL_COMBAT_RATIO * 100)}%, full detail at ≥
          {Math.round(INTEL_DETAIL_RATIO * 100)}%. Same-guild members see
          everything.
        </p>

        <div style={{ overflowX: "auto" }}>
          <table className="gw-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Commander</th>
                <th>Race</th>
                <th>Score</th>
                <th>Naq</th>
                <th>Army</th>
                <th>Strike</th>
                <th>Defence</th>
                <th>UP</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => {
                const social = allianceCombatBonus(m, save);
                const stats = visibleRealmStats(player, m, planets, social);
                const race = RACES[m.race];
                const title =
                  (m.ascensionLevel ?? 0) > 0 && m.ascendedTitle
                    ? m.ascendedTitle
                    : race.name;
                const isLeader = m.id === alliance.leaderId;
                const hint = intelHint(stats.vis);
                return (
                  <tr key={m.id}>
                    <td>{i + 1}</td>
                    <td>
                      <RealmLink realmId={m.id}>
                        {m.name}
                        {m.id === player.id ? " (you)" : ""}
                        {isLeader ? " ★" : ""}
                      </RealmLink>
                    </td>
                    <td>{title}</td>
                    <td title={hint ?? undefined}>{stats.score}</td>
                    <td title={hint ?? undefined}>{stats.naquadah}</td>
                    <td title={hint ?? undefined}>{stats.army}</td>
                    <td title={hint ?? undefined}>{stats.strike}</td>
                    <td title={hint ?? undefined}>{stats.defence}</td>
                    <td title={hint ?? undefined}>{stats.up}</td>
                    <td>
                      <button
                        type="button"
                        className="gw-btn gw-btn-ghost"
                        onClick={() => {
                          closeGuild();
                          openRealm(m.id);
                        }}
                      >
                        Profile
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {members.length === 0 && (
          <p style={{ color: "var(--gw-muted)" }}>No living members.</p>
        )}
      </div>
    </div>
  );
}
