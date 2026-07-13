"use client";

import { useMemo, useState } from "react";
import { PlayGate } from "@/components/PlayGate";
import { useGame } from "@/lib/game/GameContext";
import { formatNaq } from "@/lib/game/economy";
import {
  ASCENDED_RACE_TITLE,
  ASCENSION_GR_REQUIRED,
  ascensionRequirements,
  canSeeAscensionPanel,
} from "@/lib/game/ascension";
import {
  buildRankings,
  gloryPerTurnForRank,
  overallRankOf,
} from "@/lib/game/rankings";
import { RACES } from "@/lib/game/races";
import { RealmLink } from "@/components/RealmLink";

export default function AscensionPage() {
  return (
    <PlayGate stageMode="ascension">
      <Ascension />
    </PlayGate>
  );
}

function Ascension() {
  const { player, save, ascend, spendAp, tickNow } = useGame();
  const [msg, setMsg] = useState<string | null>(null);
  const [apSpend, setApSpend] = useState(25);

  const req = useMemo(
    () => (player ? ascensionRequirements(player) : null),
    [player],
  );

  const rankInfo = useMemo(() => {
    if (!save || !player) return { rank: 0, top: [] as ReturnType<typeof buildRankings> };
    return {
      rank: overallRankOf(save, player.id),
      top: buildRankings(save, "glory").slice(0, 5),
    };
  }, [save, player, save?.rankingsCache?.refreshedAt]);

  if (!player || !save || !req) return null;

  const rank = rankInfo.rank;
  const grPerTurn = gloryPerTurnForRank(rank, save.realms.length);
  const race = RACES[player.race];
  const evolved = ASCENDED_RACE_TITLE[player.race];
  const unlocked = canSeeAscensionPanel(player);
  const top = rankInfo.top;

  return (
    <>
      <h1 className="gw-title">Ascension</h1>
      <p className="gw-lead">
        Earn Glory & Reputation by holding a high overall rank. At{" "}
        {ASCENSION_GR_REQUIRED} G&R you may ascend — sacrifice most of your
        realm for Ascension Points and evolve toward the {evolved}.
      </p>

      <div className="gw-card">
        <h2>Glory & Reputation</h2>
        <div className="gw-stats">
          <div className="gw-stat">
            <span>G&R</span>
            <strong>
              {formatNaq(player.gloryReputation)} / {ASCENSION_GR_REQUIRED}
            </strong>
          </div>
          <div className="gw-stat">
            <span>Overall rank</span>
            <strong>
              #{rank} / {save.realms.length}
            </strong>
          </div>
          <div className="gw-stat">
            <span>G&R / turn</span>
            <strong>+{grPerTurn}</strong>
          </div>
          <div className="gw-stat">
            <span>Ascension level</span>
            <strong>{player.ascensionLevel}</strong>
          </div>
          <div className="gw-stat">
            <span>Ascension Points</span>
            <strong>{formatNaq(player.ascensionPoints)}</strong>
          </div>
          <div className="gw-stat">
            <span>Title</span>
            <strong>
              {player.ascendedTitle ?? race.name}
            </strong>
          </div>
        </div>
        <p style={{ color: "var(--gw-muted)", fontSize: "0.85rem" }}>
          Rank 1 → +10 · top ~15% → +5 · top ~40% → +1 · otherwise 0. Vacation
          realms earn none.
        </p>
        <button
          type="button"
          className="gw-btn gw-btn-ghost"
          onClick={() => {
            tickNow();
            setMsg("Turn forced — G&R awarded from current ranks");
          }}
        >
          Force turn (earn G&R now)
        </button>
      </div>

      {!unlocked ? (
        <div className="gw-card">
          <h2>Path sealed</h2>
          <p style={{ color: "var(--gw-muted)" }}>
            Reach {Math.ceil(ASCENSION_GR_REQUIRED * 0.5)} G&R to open the full
            ascension checklist. Climb the rankings and wait for turns.
          </p>
        </div>
      ) : (
        <div className="gw-card">
          <h2>Ascension checklist (level {req.nextLevel})</h2>
          <table className="gw-table">
            <thead>
              <tr>
                <th>Requirement</th>
                <th>Have</th>
                <th>Need</th>
                <th>OK</th>
              </tr>
            </thead>
            <tbody>
              <ReqRow
                label="Glory & Reputation"
                have={req.gloryHave}
                need={req.gloryNeeded}
                ok={req.gloryOk}
              />
              <ReqRow
                label="Unit Production"
                have={player.unitProductionLevel}
                need={req.minUp}
                ok={req.upOk}
              />
              <ReqRow
                label="Untrained units"
                have={req.untrainedHave}
                need={req.untrainedNeeded}
                ok={req.untrainedOk}
              />
              <ReqRow
                label="Trained combat units"
                have={req.trainedHave}
                need={req.trainedNeeded}
                ok={req.trainedOk}
              />
              <ReqRow
                label="Naquadah (open + bank)"
                have={req.naqHave}
                need={req.naqNeeded}
                ok={req.naqOk}
              />
            </tbody>
          </table>
          <p style={{ color: "var(--gw-muted)" }}>
            Estimated AP from this sacrifice:{" "}
            <strong style={{ color: "var(--gw-text)" }}>
              {formatNaq(req.estimatedAp)}
            </strong>
            . Kept: miners, mothership, planets, AP bank. Lost: most Naq,
            weapons, tech, trained units, UP/spy levels (soft-reset with
            blessings).
          </p>
          <button
            type="button"
            className="gw-btn"
            disabled={!req.ready}
            onClick={() => {
              if (
                !confirm(
                  `Ascend to level ${req.nextLevel} as ${evolved}? This sacrifices most of your realm.`,
                )
              )
                return;
              const result = ascend();
              if (typeof result === "string") setMsg(result);
              else
                setMsg(
                  `Ascended! +${result.apGained} AP · title ${result.title}`,
                );
            }}
          >
            {req.ready
              ? `Ascend → ${evolved}`
              : "Requirements not met"}
          </button>
        </div>
      )}

      {(player.ascensionPoints ?? 0) > 0 && (
        <div className="gw-card">
          <h2>Spend Ascension Points</h2>
          <p style={{ color: "var(--gw-muted)" }}>
            AP also passively boosts combat and income. You can burn AP for
            immediate boosts.
          </p>
          <div className="gw-field" style={{ maxWidth: 160, marginBottom: "0.75rem" }}>
            <label htmlFor="ap">AP to spend</label>
            <input
              id="ap"
              className="gw-input"
              type="number"
              min={1}
              value={apSpend}
              onChange={(e) => setApSpend(Number(e.target.value))}
            />
          </div>
          <div className="gw-row">
            <button
              type="button"
              className="gw-btn"
              onClick={() =>
                setMsg(
                  spendAp(apSpend, "up") ??
                    `Spent ${apSpend} AP on Unit Production`,
                )
              }
            >
              → UP (~{Math.max(1, Math.floor(apSpend / 15))} lv)
            </button>
            <button
              type="button"
              className="gw-btn gw-btn-ghost"
              onClick={() =>
                setMsg(
                  spendAp(apSpend, "naq") ??
                    `Spent ${apSpend} AP for ${formatNaq(apSpend * 40)} Naq`,
                )
              }
            >
              → Naq (×40)
            </button>
            <button
              type="button"
              className="gw-btn gw-btn-ghost"
              onClick={() =>
                setMsg(
                  spendAp(apSpend, "tech") ??
                    `Spent ${apSpend} AP on tech`,
                )
              }
            >
              → Tech
            </button>
          </div>
        </div>
      )}

      <div className="gw-card">
        <h2>G&R leaders</h2>
        <table className="gw-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>G&R</th>
              <th>Asc</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={r.realm.id}>
                <td>{r.rank}</td>
                <td>
                  <RealmLink realmId={r.realm.id}>
                    {r.realm.name}
                    {r.realm.id === player.id ? " (you)" : ""}
                  </RealmLink>
                </td>
                <td>{formatNaq(r.gloryReputation)}</td>
                <td>{r.ascensionLevel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {msg && <div className="gw-msg">{msg}</div>}
    </>
  );
}

function ReqRow({
  label,
  have,
  need,
  ok,
}: {
  label: string;
  have: number;
  need: number;
  ok: boolean;
}) {
  return (
    <tr>
      <td>{label}</td>
      <td>{formatNaq(have)}</td>
      <td>{formatNaq(need)}</td>
      <td style={{ color: ok ? "var(--gw-ok)" : "var(--gw-danger)" }}>
        {ok ? "yes" : "no"}
      </td>
    </tr>
  );
}
