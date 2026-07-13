"use client";

import { PlayGate } from "@/components/PlayGate";
import { RealmLink } from "@/components/RealmLink";
import { useGame } from "@/lib/game/GameContext";

export default function IntelligencePage() {
  return (
    <PlayGate stageMode="intel">
      <Intelligence />
    </PlayGate>
  );
}

function Intelligence() {
  const { save } = useGame();
  if (!save) return null;
  const logs = save.logs.intelligence;

  return (
    <>
      <h1 className="gw-title">Intelligence</h1>
      <p className="gw-lead">
        Spy, sabotage, and assassination reports. Successful quiet recon may stay
        hidden from the target. Click a name to open their profile.
      </p>
      <div className="gw-card">
        <h2>Covert log</h2>
        {logs.length === 0 ? (
          <p style={{ color: "var(--gw-muted)" }}>No missions yet.</p>
        ) : (
          <table className="gw-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Kind</th>
                <th>Actor</th>
                <th>Target</th>
                <th>OK</th>
                <th>Detected</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{new Date(l.at).toLocaleString()}</td>
                  <td>{l.kind}</td>
                  <td>
                    <RealmLink realmId={l.actorId}>{l.actorName}</RealmLink>
                  </td>
                  <td>
                    <RealmLink realmId={l.targetId}>{l.targetName}</RealmLink>
                  </td>
                  <td>{l.success ? "yes" : "no"}</td>
                  <td>{l.detected ? "yes" : "no"}</td>
                  <td>
                    {l.details}
                    {l.revealed && (
                      <div style={{ color: "var(--gw-muted)", fontSize: "0.8rem" }}>
                        Revealed: {JSON.stringify(l.revealed)}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
