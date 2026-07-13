"use client";

import { useEffect, useMemo, useState } from "react";
import type { AttackLogEntry, IntelLogEntry } from "@/lib/db/schema";
import { useGame } from "@/lib/game/GameContext";
import { useProfile } from "@/lib/game/ProfileContext";
import { RACES } from "@/lib/game/races";
import {
  defenceAction,
  formatNaq,
  formatNaqExact,
  strikeAction,
} from "@/lib/game/economy";
import { overallRankOf } from "@/lib/game/rankings";
import {
  FACTIONS,
  allianceCombatBonus,
  factionOf,
  getAlliance,
  sameAlliance,
  sameFaction,
} from "@/lib/game/guilds";
import {
  intelHint,
  visibleRealmStats,
} from "@/lib/game/intelVisibility";
import { MIN_CONTRACT_AMOUNT } from "@/lib/game/contracts";
import {
  eradicationChance,
  eradicationPowerRatio,
  ERADICATION_TURN_COST,
} from "@/lib/game/wars";
import { BattleScene } from "@/components/BattleScene";
import { RaceWirePreview } from "@/components/RaceWirePreview";
import { GuildLink } from "@/components/GuildLink";

export function RealmProfileModal() {
  const { activeRealmId, closeRealm } = useProfile();
  const {
    save,
    player,
    attack,
    eradicate,
    spy,
    sabotage,
    assassinate,
    requestDonation,
  } = useGame();

  const [turns, setTurns] = useState(5);
  const [agents, setAgents] = useState(3);
  const [donateAmt, setDonateAmt] = useState(1000);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [battleLog, setBattleLog] = useState<AttackLogEntry | null>(null);

  const realm = useMemo(() => {
    if (!save || !activeRealmId) return null;
    return save.realms.find((r) => r.id === activeRealmId) ?? null;
  }, [save, activeRealmId]);

  useEffect(() => {
    setMsg(null);
    setBattleLog(null);
    if (player) {
      setAgents(Math.min(3, Math.max(1, player.units.covert || 1)));
    }
  }, [activeRealmId, player]);

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

  useEffect(() => {
    if (!activeRealmId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRealm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeRealmId, closeRealm]);

  if (!activeRealmId || !save || !player || !realm) return null;

  const planets = save.planets ?? [];
  const race = RACES[realm.race];
  const guild = getAlliance(save, realm.allianceId);
  const faction = factionOf(realm);
  const social = allianceCombatBonus(realm, save);
  const mySocial = allianceCombatBonus(player, save);
  const myStrike = strikeAction(player, planets, mySocial);
  const isSelf = realm.id === player.id;
  const friendly =
    !isSelf && (sameAlliance(player, realm) || sameFaction(player, realm));
  const hostile = !isSelf && !friendly && !realm.vacation;
  const stats = visibleRealmStats(player, realm, planets, social);
  const defenceNum = defenceAction(realm, planets, social);
  const beatable =
    hostile && stats.vis.seeCombat && myStrike > defenceNum;
  const hint = intelHint(stats.vis);

  const rank = overallRankOf(save, realm.id);

  const postDirectRequest = () => {
    const err = requestDonation({
      amount: donateAmt,
      message: `Aid request to ${realm.name}`,
      scope: "direct",
      targetId: realm.id,
    });
    setMsg(
      err
        ? { ok: false, text: err }
        : { ok: true, text: `Requested ${formatNaq(donateAmt)} Naq from ${realm.name}` },
    );
  };

  return (
    <div
      className="gw-modal-backdrop"
      role="presentation"
      onClick={closeRealm}
    >
      <div
        className="gw-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="realm-profile-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gw-modal-head">
          <div style={{ display: "flex", gap: "0.85rem", alignItems: "center" }}>
            <RaceWirePreview race={realm.race} size={72} ascensionLevel={realm.ascensionLevel ?? 0} />
            <div>
              <h2 id="realm-profile-title" className="gw-modal-title">
                {realm.name}
                {isSelf ? " (you)" : ""}
              </h2>
              <p className="gw-modal-sub">
                {realm.ascendedTitle ?? race.name}
                {guild ? (
                  <>
                    {" · "}
                    <GuildLink allianceId={guild.id}>
                      [{guild.tag}] {guild.name}
                    </GuildLink>
                  </>
                ) : (
                  " · No guild"
                )}
                {" · "}
                <span style={{ color: FACTIONS[faction].color }}>
                  {FACTIONS[faction].name}
                </span>
                {realm.vacation ? " · Vacation" : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="gw-btn gw-btn-ghost"
            onClick={closeRealm}
            aria-label="Close profile"
          >
            Close
          </button>
        </div>

        <div className="gw-stats" style={{ marginBottom: "0.85rem" }}>
          <div className="gw-stat">
            <span>Rank</span>
            <strong>
              #{rank} / {save.realms.length}
            </strong>
          </div>
          <div className="gw-stat" title={hint ?? undefined}>
            <span>Score</span>
            <strong>{stats.score}</strong>
          </div>
          <div className="gw-stat" title={hint ?? undefined}>
            <span>Open Naq</span>
            <strong>{stats.naquadah}</strong>
          </div>
          <div className="gw-stat" title={hint ?? undefined}>
            <span>UP</span>
            <strong>{stats.up}</strong>
          </div>
          <div className="gw-stat" title={hint ?? undefined}>
            <span>Strike</span>
            <strong>{stats.strike}</strong>
          </div>
          <div className="gw-stat" title={hint ?? undefined}>
            <span>Defence</span>
            <strong>{stats.defence}</strong>
          </div>
          <div className="gw-stat" title={hint ?? undefined}>
            <span>G&R</span>
            <strong>{stats.glory}</strong>
          </div>
          <div className="gw-stat" title={hint ?? undefined}>
            <span>Ascension</span>
            <strong>{stats.ascension}</strong>
          </div>
        </div>

        <div className="gw-stats" style={{ marginBottom: "1rem" }}>
          <div className="gw-stat" title={hint ?? undefined}>
            <span>Untrained</span>
            <strong>{stats.untrained}</strong>
          </div>
          <div className="gw-stat" title={hint ?? undefined}>
            <span>Miners</span>
            <strong>{stats.miners}</strong>
          </div>
          <div className="gw-stat" title={hint ?? undefined}>
            <span>Offence</span>
            <strong>{stats.offence}</strong>
          </div>
          <div className="gw-stat" title={hint ?? undefined}>
            <span>Defence units</span>
            <strong>{stats.defenceUnits}</strong>
          </div>
          <div className="gw-stat" title={hint ?? undefined}>
            <span>Covert</span>
            <strong>{stats.covert}</strong>
          </div>
          <div className="gw-stat" title={hint ?? undefined}>
            <span>Mothership</span>
            <strong>{stats.mothership}</strong>
          </div>
        </div>

        {hint && (
          <p
            style={{
              color: "var(--gw-muted)",
              fontSize: "0.85rem",
              marginTop: "-0.35rem",
            }}
          >
            {hint}
          </p>
        )}

        {isSelf && (
          <p style={{ color: "var(--gw-muted)", fontSize: "0.9rem" }}>
            This is your commander profile. Use the nav for training, armory,
            and upgrades.
          </p>
        )}

        {friendly && (
          <div className="gw-card" style={{ margin: 0 }}>
            <h3 style={{ marginTop: 0, fontSize: "1rem" }}>Ally actions</h3>
            <p style={{ color: "var(--gw-muted)", fontSize: "0.85rem" }}>
              Same guild or faction — no hostile actions. You can request a
              direct donation.
            </p>
            <div className="gw-row">
              <div className="gw-field">
                <label htmlFor="prof-donate">Request Naq</label>
                <input
                  id="prof-donate"
                  className="gw-input"
                  type="number"
                  min={MIN_CONTRACT_AMOUNT}
                  value={donateAmt}
                  onChange={(e) => setDonateAmt(Number(e.target.value))}
                />
              </div>
              <button
                type="button"
                className="gw-btn"
                onClick={postDirectRequest}
              >
                Request donation
              </button>
            </div>
          </div>
        )}

        {hostile && (
          <div className="gw-card" style={{ margin: 0 }}>
            <h3 style={{ marginTop: 0, fontSize: "1rem" }}>Hostile actions</h3>
            {battleLog && battleLog.defenderId === realm.id && (
              <BattleScene
                attackerRace={player.race}
                defenderRace={realm.race}
                attackerAscension={player.ascensionLevel ?? 0}
                defenderAscension={realm.ascensionLevel ?? 0}
                log={battleLog}
              />
            )}
            <p style={{ color: "var(--gw-muted)", fontSize: "0.85rem" }}>
              Your Strike{" "}
              <span title={formatNaqExact(myStrike)}>{formatNaq(myStrike)}</span>{" "}
              vs their Defence{" "}
              <span
                title={
                  stats.vis.seeCombat
                    ? formatNaqExact(defenceNum)
                    : "Sealed — raise Covert"
                }
              >
                {stats.defence}
              </span>
              {beatable ? " — beatable" : " — tough target"}. Turns left:{" "}
              {player.attackTurns}. Covert cap: {player.covertCapacity}.
              {eradicationChance(eradicationPowerRatio(player, realm, planets)) >
                0 && (
                <>
                  {" "}
                  Eradication{" "}
                  {(
                    eradicationChance(
                      eradicationPowerRatio(player, realm, planets),
                    ) * 100
                  ).toFixed(0)}
                  % at{" "}
                  {eradicationPowerRatio(player, realm, planets).toFixed(0)}×.
                </>
              )}
            </p>
            <div className="gw-row">
              <div className="gw-field">
                <label htmlFor="prof-turns">Attack turns</label>
                <input
                  id="prof-turns"
                  className="gw-input"
                  type="number"
                  min={1}
                  max={15}
                  value={turns}
                  onChange={(e) => setTurns(Number(e.target.value))}
                />
              </div>
              <div className="gw-field">
                <label htmlFor="prof-agents">Agents</label>
                <input
                  id="prof-agents"
                  className="gw-input"
                  type="number"
                  min={1}
                  max={Math.max(1, player.units.covert)}
                  value={agents}
                  onChange={(e) => setAgents(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="gw-row" style={{ marginTop: "0.75rem" }}>
              <button
                type="button"
                className="gw-btn"
                onClick={() => report(attack(realm.id, turns, "attack"))}
              >
                Attack
              </button>
              <button
                type="button"
                className="gw-btn"
                onClick={() => report(attack(realm.id, turns, "raid"))}
              >
                Raid
              </button>
              <button
                type="button"
                className="gw-btn gw-btn-danger"
                disabled={
                  eradicationChance(
                    eradicationPowerRatio(player, realm, planets),
                  ) <= 0 || player.attackTurns < ERADICATION_TURN_COST
                }
                onClick={() => report(eradicate(realm.id))}
              >
                Eradicate (
                {(
                  eradicationChance(
                    eradicationPowerRatio(player, realm, planets),
                  ) * 100
                ).toFixed(0)}
                %)
              </button>
              <button
                type="button"
                className="gw-btn gw-btn-ghost"
                onClick={() => report(spy(realm.id, agents))}
              >
                Spy
              </button>
              <button
                type="button"
                className="gw-btn gw-btn-ghost"
                onClick={() => report(sabotage(realm.id, agents))}
              >
                Sabotage
              </button>
              <button
                type="button"
                className="gw-btn gw-btn-danger"
                onClick={() => report(assassinate(realm.id, agents))}
              >
                Assassinate
              </button>
            </div>
            <div className="gw-row" style={{ marginTop: "0.75rem" }}>
              <div className="gw-field">
                <label htmlFor="prof-req">Request Naq (direct)</label>
                <input
                  id="prof-req"
                  className="gw-input"
                  type="number"
                  min={MIN_CONTRACT_AMOUNT}
                  value={donateAmt}
                  onChange={(e) => setDonateAmt(Number(e.target.value))}
                />
              </div>
              <button
                type="button"
                className="gw-btn gw-btn-ghost"
                onClick={postDirectRequest}
              >
                Request donation
              </button>
            </div>
          </div>
        )}

        {!isSelf && realm.vacation && (
          <p style={{ color: "var(--gw-muted)" }}>
            This commander is on vacation — no hostile actions.
          </p>
        )}

        {msg && (
          <div className={`gw-msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>
        )}
      </div>
    </div>
  );
}
