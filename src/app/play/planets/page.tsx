"use client";

import { useMemo, useState } from "react";
import { PlayGate } from "@/components/PlayGate";
import { useGame } from "@/lib/game/GameContext";
import { formatNaq, mothershipAction, strikeAction } from "@/lib/game/economy";
import { RealmLink } from "@/components/RealmLink";

export default function PlanetsPage() {
  return (
    <PlayGate stageMode="planets">
      <Planets />
    </PlayGate>
  );
}

function Planets() {
  const { save, player, conquerPlanet } = useGame();
  const [msg, setMsg] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (!save) return [];
    return [...(save.planets ?? [])].sort(
      (a, b) => a.defenceRating - b.defenceRating,
    );
  }, [save]);

  if (!player || !save) return null;

  const owned = rows.filter((p) => p.ownerId === player.id);
  const fleet =
    strikeAction(player, save.planets) * 0.35 + mothershipAction(player);
  const dayLeft =
    player.lastPlanetConquerAt &&
    Date.now() - player.lastPlanetConquerAt < 24 * 60 * 60 * 1000;

  return (
    <>
      <h1 className="gw-title">Planets</h1>
      <p className="gw-lead">
        Annex worlds for flat Naq and UU income. Requires a mothership and 5
        attack turns. One successful conquer per day. Fleet power ≈{" "}
        {formatNaq(fleet)}.
      </p>

      <div className="gw-card">
        <h2>Your holdings ({owned.length})</h2>
        {owned.length === 0 ? (
          <p style={{ color: "var(--gw-muted)" }}>No planets controlled yet.</p>
        ) : (
          <table className="gw-table">
            <thead>
              <tr>
                <th>Planet</th>
                <th>Mining / turn</th>
                <th>UU / turn</th>
              </tr>
            </thead>
            <tbody>
              {owned.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{formatNaq(p.miningYield)} Naq</td>
                  <td>+{p.upYield}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="gw-card">
        <h2>Galaxy</h2>
        {dayLeft && (
          <p style={{ color: "var(--gw-muted)" }}>
            Daily conquer already used — try again tomorrow (or after 24h).
          </p>
        )}
        <table className="gw-table">
          <thead>
            <tr>
              <th>Planet</th>
              <th>Owner</th>
              <th>Defence</th>
              <th>Yield</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const ownerRealm =
                p.ownerId == null
                  ? null
                  : save.realms.find((r) => r.id === p.ownerId);
              const mine = p.ownerId === player.id;
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>
                    {ownerRealm ? (
                      <RealmLink realmId={ownerRealm.id}>
                        {ownerRealm.name}
                      </RealmLink>
                    ) : (
                      "Neutral"
                    )}
                  </td>
                  <td>{formatNaq(p.defenceRating)}</td>
                  <td>
                    {formatNaq(p.miningYield)} Naq · +{p.upYield} UU
                  </td>
                  <td>
                    {!mine && (
                      <button
                        type="button"
                        className="gw-btn"
                        disabled={(player.mothership?.tier ?? 0) < 1}
                        onClick={() => {
                          const result = conquerPlanet(p.id);
                          if (typeof result === "string") setMsg(result);
                          else setMsg(result.summary);
                        }}
                      >
                        Conquer
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {msg && <div className="gw-msg">{msg}</div>}
      </div>
    </>
  );
}
