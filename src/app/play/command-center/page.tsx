"use client";

import { useMemo } from "react";
import { PlayGate } from "@/components/PlayGate";
import { AlienTerminal } from "@/components/AlienTerminal";
import { useGame } from "@/lib/game/GameContext";
import { RACES } from "@/lib/game/races";
import {
  formatNaq,
  formatNaqExact,
  incomePerTurn,
  uuPerTurn,
  strikeAction,
  defenceAction,
  covertAction,
  antiCovertAction,
  mothershipAction,
  overallRankScore,
  ensureTech,
  ownedPlanets,
} from "@/lib/game/economy";
import { allianceIncomeBonus, guildUpBonus, guildFundIncome } from "@/lib/game/guilds";
import { RealmLink } from "@/components/RealmLink";
import { RaceWirePreview } from "@/components/RaceWirePreview";
import { ensureNews } from "@/lib/game/news";

export default function CommandCenterPage() {
  return (
    <PlayGate stageMode="command">
      <CommandCenter />
    </PlayGate>
  );
}

function CommandCenter() {
  const { player, tickNow, aiPulseNow, save, setPlayerAiEnabled } = useGame();
  if (!player || !save) return null;
  const race = RACES[player.race];
  const planets = save.planets ?? [];
  const snap = save.rankingsCache?.byId[player.id];
  const myScore = snap?.overall ?? overallRankScore(player, planets);

  const { livingCount, rank, deadCount, rivalCount } = useMemo(() => {
    const cache = save.rankingsCache;
    if (cache) {
      let dead = 0;
      let rivals = 0;
      for (const r of save.realms) {
        if (r.dead) dead += 1;
        else if (!r.isPlayer) rivals += 1;
      }
      return {
        livingCount: cache.livingCount,
        rank: cache.byId[player.id]?.overallRank ?? 1,
        deadCount: dead,
        rivalCount: rivals,
      };
    }
    let living = 0;
    let dead = 0;
    let better = 0;
    let rivals = 0;
    for (const r of save.realms) {
      if (r.dead) {
        dead += 1;
        continue;
      }
      living += 1;
      if (r.isPlayer) continue;
      rivals += 1;
      if (overallRankScore(r, planets) > myScore) better += 1;
    }
    return {
      livingCount: living,
      rank: better + 1,
      deadCount: dead,
      rivalCount: rivals,
    };
  }, [save, planets, myScore, player.id]);

  const aiOn = save.settings.aiEnabled !== false;
  const playerAiOn = !!save.settings.playerAiEnabled;
  const pulses = save.settings.aiPulsesPerHour ?? 8;
  const tech = ensureTech(player);
  const holdings = ownedPlanets(player, planets);
  const social = allianceIncomeBonus(player, save);
  const guildUu = guildUpBonus(player, save);
  const baseIncome = incomePerTurn(player, planets, social);
  const fundIncome = guildFundIncome(player, save);
  const totalIncome = baseIncome + fundIncome;
  const news = ensureNews(save);

  return (
    <>
      <h1 className="gw-title">Command Center</h1>
      <p className="gw-lead">
        <RealmLink realmId={player.id}>{player.name}</RealmLink> · {race.name} ·
        Rank #{rank} of {livingCount}. {race.bankName} holds protected Naq.
        Click any commander name to open their profile.
      </p>

      <div className="gw-card">
        <h2>Autopilot</h2>
        <label className="gw-check">
          <input
            type="checkbox"
            checked={playerAiOn}
            onChange={(e) => setPlayerAiEnabled(e.target.checked)}
          />
          <span>
            <strong>AI mode</strong> — let the AI run this account (train, fight,
            market, guilds, forum) using the same brain as rivals.
          </span>
        </label>
        {playerAiOn ? (
          <p
            style={{
              color: "var(--race-glow)",
              fontSize: "0.85rem",
              margin: "0.65rem 0 0",
            }}
          >
            Autopilot is on. Your commander will act on AI pulses and LLM think
            waves. You can still play manually anytime — uncheck to take back
            control.
          </p>
        ) : (
          <p
            style={{
              color: "var(--gw-muted)",
              fontSize: "0.85rem",
              margin: "0.65rem 0 0",
            }}
          >
            Off by default. When enabled, a persona and plan are built for you
            and executed alongside rival AIs.
          </p>
        )}
      </div>

      <div className="gw-cc-layout">
        <div className="gw-cc-main">
          <div className="gw-card">
            <h2>User Info</h2>
            <div
              style={{
                display: "flex",
                gap: "1rem",
                alignItems: "flex-start",
                marginBottom: "0.85rem",
              }}
            >
              <RaceWirePreview
                race={player.race}
                size={88}
                ascensionLevel={player.ascensionLevel ?? 0}
              />
              <p className="gw-lead" style={{ margin: 0 }}>
                Hull scan for {race.name}
                {player.ascendedTitle ? ` · ${player.ascendedTitle}` : ""}.
              </p>
            </div>
            <div className="gw-stats">
              <div className="gw-stat" title={formatNaqExact(player.naquadah)}>
                <span>Open Naquadah</span>
                <strong>{formatNaq(player.naquadah)}</strong>
              </div>
              <div
                className="gw-stat"
                title={formatNaqExact(player.bankNaquadah)}
              >
                <span>{race.bankName}</span>
                <strong>{formatNaq(player.bankNaquadah)}</strong>
              </div>
              <div
                className="gw-stat"
                title={
                  fundIncome > 0
                    ? `${formatNaqExact(baseIncome)} base + ${formatNaqExact(fundIncome)} guild fund dividend`
                    : formatNaqExact(baseIncome)
                }
              >
                <span>Income / turn</span>
                <strong>{formatNaq(totalIncome)}</strong>
              </div>
              <div className="gw-stat">
                <span>UU / turn (UP {player.unitProductionLevel})</span>
                <strong>{uuPerTurn(player, planets, guildUu)}</strong>
              </div>
              <div className="gw-stat">
                <span>Attack Turns</span>
                <strong>{player.attackTurns}</strong>
              </div>
              <div className="gw-stat">
                <span>Covert Capacity</span>
                <strong>{player.covertCapacity}</strong>
              </div>
              <div className="gw-stat">
                <span>Defence Alert</span>
                <strong>{player.defenceAlert.toFixed(1)} / 50</strong>
              </div>
              <div className="gw-stat">
                <span>Attack Fatigue</span>
                <strong>{player.attackFatigue.toFixed(1)} / 50</strong>
              </div>
              <div className="gw-stat">
                <span>Planets</span>
                <strong>{holdings.length}</strong>
              </div>
              <div className="gw-stat">
                <span>Mothership</span>
                <strong>
                  {player.mothership?.tier
                    ? `${player.mothership.name} (T${player.mothership.tier})`
                    : "None — open Mothership Bay"}
                </strong>
              </div>
              <div className="gw-stat">
                <span>Glory & Reputation</span>
                <strong>{formatNaq(player.gloryReputation ?? 0)}</strong>
              </div>
              <div className="gw-stat">
                <span>Ascension</span>
                <strong>
                  L{player.ascensionLevel ?? 0} ·{" "}
                  {formatNaq(player.ascensionPoints ?? 0)} AP
                </strong>
              </div>
            </div>
            <div className="gw-row" style={{ marginTop: "1rem" }}>
              <button
                type="button"
                className="gw-btn gw-btn-ghost"
                onClick={tickNow}
              >
                Force turn tick (dev)
              </button>
              <button
                type="button"
                className="gw-btn gw-btn-ghost"
                onClick={() => aiPulseNow()}
              >
                Force AI pulse
              </button>
              <span style={{ color: "var(--gw-muted)", fontSize: "0.85rem" }}>
                Turn: {save.settings.turnMinutes} min · AI:{" "}
                {aiOn ? `${pulses}/hr` : "off"} · {rivalCount}{" "}
                rivals
                {deadCount > 0 ? ` · ${deadCount} dead` : ""}
              </span>
            </div>
          </div>

          <div className="gw-card">
            <h2>Military Effectiveness</h2>
            <div className="gw-stats">
              <div
                className="gw-stat"
                title={formatNaqExact(strikeAction(player, planets))}
              >
                <span>Strike Action</span>
                <strong>{formatNaq(strikeAction(player, planets))}</strong>
              </div>
              <div
                className="gw-stat"
                title={formatNaqExact(defenceAction(player, planets))}
              >
                <span>Defensive Action</span>
                <strong>{formatNaq(defenceAction(player, planets))}</strong>
              </div>
              <div
                className="gw-stat"
                title={formatNaqExact(covertAction(player))}
              >
                <span>Covert Action</span>
                <strong>{formatNaq(covertAction(player))}</strong>
              </div>
              <div
                className="gw-stat"
                title={formatNaqExact(antiCovertAction(player))}
              >
                <span>Anti-Covert</span>
                <strong>{formatNaq(antiCovertAction(player))}</strong>
              </div>
              <div
                className="gw-stat"
                title={formatNaqExact(mothershipAction(player))}
              >
                <span>Mothership</span>
                <strong>{formatNaq(mothershipAction(player))}</strong>
              </div>
              <div className="gw-stat" title={formatNaqExact(myScore)}>
                <span>Overall score</span>
                <strong>{formatNaq(myScore)}</strong>
              </div>
            </div>
          </div>

          <div className="gw-card">
            <h2>Tech snapshot</h2>
            <div className="gw-stats">
              <div className="gw-stat">
                <span>General</span>
                <strong>{tech.general}</strong>
              </div>
              <div className="gw-stat">
                <span>Mining</span>
                <strong>{tech.mining}</strong>
              </div>
              <div className="gw-stat">
                <span>Offence</span>
                <strong>{tech.offence}</strong>
              </div>
              <div className="gw-stat">
                <span>Defence</span>
                <strong>{tech.defence}</strong>
              </div>
              <div className="gw-stat">
                <span>Covert</span>
                <strong>{tech.covert}</strong>
              </div>
              <div className="gw-stat">
                <span>Equipment</span>
                <strong>{tech.equipment}</strong>
              </div>
            </div>
          </div>

          <div className="gw-card">
            <h2>Personnel</h2>
            <div className="gw-stats">
              <div className="gw-stat">
                <span>{race.units.untrained}</span>
                <strong>{formatNaq(player.units.untrained)}</strong>
              </div>
              <div className="gw-stat">
                <span>{race.units.miners}</span>
                <strong>{formatNaq(player.units.miners ?? 0)}</strong>
              </div>
              <div className="gw-stat">
                <span>{race.units.offence}</span>
                <strong>{formatNaq(player.units.offence)}</strong>
              </div>
              <div className="gw-stat">
                <span>{race.units.defence}</span>
                <strong>{formatNaq(player.units.defence)}</strong>
              </div>
              <div className="gw-stat">
                <span>{race.units.covert}</span>
                <strong>{formatNaq(player.units.covert)}</strong>
              </div>
              <div className="gw-stat">
                <span>{race.units.antiCovert}</span>
                <strong>{formatNaq(player.units.antiCovert)}</strong>
              </div>
            </div>
          </div>
        </div>

        <AlienTerminal news={news} />
      </div>
    </>
  );
}
