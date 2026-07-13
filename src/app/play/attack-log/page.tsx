"use client";

import { useMemo, useState } from "react";
import { PlayGate } from "@/components/PlayGate";
import { RealmLink } from "@/components/RealmLink";
import { useGame } from "@/lib/game/GameContext";

type Filter = "all" | "made" | "against";

export default function AttackLogPage() {
  return (
    <PlayGate stageMode="log">
      <AttackLog />
    </PlayGate>
  );
}

function AttackLog() {
  const { save, player } = useGame();
  const [filter, setFilter] = useState<Filter>("all");

  const logs = useMemo(() => {
    if (!save || !player) return [];
    const all = save.logs.attacks;
    if (filter === "made") {
      return all.filter((l) => l.attackerId === player.id);
    }
    if (filter === "against") {
      return all.filter(
        (l) => l.defenderId === player.id && l.kind !== "planet",
      );
    }
    return all.filter(
      (l) =>
        l.attackerId === player.id ||
        l.defenderId === player.id ||
        (l.kind === "planet" && l.attackerId === player.id),
    );
  }, [save, player, filter]);

  if (!save || !player) return null;

  const madeCount = save.logs.attacks.filter(
    (l) => l.attackerId === player.id,
  ).length;
  const againstCount = save.logs.attacks.filter(
    (l) => l.defenderId === player.id && l.kind !== "planet",
  ).length;

  return (
    <>
      <h1 className="gw-title">Attack Log</h1>
      <p className="gw-lead">
        Recent battles involving your realm. Player fights are reserved in the
        log so AI wars cannot wipe them out. Click a name to open their profile.
      </p>
      <div className="gw-card">
        <h2>History</h2>
        <div className="gw-row" style={{ marginBottom: "0.85rem" }}>
          <button
            type="button"
            className={`gw-btn ${filter === "all" ? "" : "gw-btn-ghost"}`}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          <button
            type="button"
            className={`gw-btn ${filter === "made" ? "" : "gw-btn-ghost"}`}
            onClick={() => setFilter("made")}
          >
            Attacks I made ({madeCount})
          </button>
          <button
            type="button"
            className={`gw-btn ${filter === "against" ? "" : "gw-btn-ghost"}`}
            onClick={() => setFilter("against")}
          >
            Attacks against me ({againstCount})
          </button>
        </div>
        {logs.length === 0 ? (
          <p style={{ color: "var(--gw-muted)" }}>
            {filter === "made"
              ? "No outbound attacks logged yet."
              : filter === "against"
                ? "No inbound attacks logged yet."
                : "No battles yet."}
          </p>
        ) : (
          <table className="gw-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Kind</th>
                <th>Attacker</th>
                <th>Defender</th>
                <th>Turns</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{new Date(l.at).toLocaleString()}</td>
                  <td>{l.kind}</td>
                  <td>
                    <RealmLink realmId={l.attackerId}>
                      {l.attackerName}
                    </RealmLink>
                  </td>
                  <td>
                    {l.kind === "planet" ? (
                      l.defenderName
                    ) : (
                      <RealmLink realmId={l.defenderId}>
                        {l.defenderName}
                      </RealmLink>
                    )}
                  </td>
                  <td>{l.turnsUsed}</td>
                  <td>{l.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
