"use client";

import { useMemo, useState } from "react";
import { PlayGate } from "@/components/PlayGate";
import { useGame } from "@/lib/game/GameContext";
import { formatNaq } from "@/lib/game/economy";
import {
  FACTIONS,
  factionOf,
  getAlliance,
} from "@/lib/game/guilds";
import {
  MAX_CONTRACT_AMOUNT,
  MIN_CONTRACT_AMOUNT,
  openPublicContracts,
  visibleContractsFor,
} from "@/lib/game/contracts";
import type { ContractScope } from "@/lib/db/schema";
import { RealmLink } from "@/components/RealmLink";

export default function ContractsPage() {
  return (
    <PlayGate stageMode="contracts">
      <Contracts />
    </PlayGate>
  );
}

function Contracts() {
  const {
    save,
    player,
    requestDonation,
    fulfillDonation,
    cancelDonation,
    declineDonation,
  } = useGame();
  const [amount, setAmount] = useState(1000);
  const [message, setMessage] = useState("Need Naq for upgrades");
  const [scope, setScope] = useState<ContractScope>("public");
  const [targetId, setTargetId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const list = useMemo(() => {
    if (!save || !player) return [];
    return visibleContractsFor(save, player);
  }, [save, player]);

  const publicBoard = useMemo(() => {
    if (!save) return [];
    return openPublicContracts(save);
  }, [save]);

  if (!player || !save) return null;

  const mine = getAlliance(save, player.allianceId);
  const myFaction = factionOf(player);
  const openMine = list.filter(
    (c) => c.requesterId === player.id && c.status === "open",
  );
  const incoming = list.filter(
    (c) =>
      c.status === "open" &&
      c.requesterId !== player.id &&
      c.scope !== "public",
  );
  const history = list.filter((c) => c.status !== "open").slice(0, 30);

  const allies = mine
    ? save.realms.filter(
        (r) =>
          r.id !== player.id &&
          r.allianceId === player.allianceId &&
          !r.vacation,
      )
    : [];

  const run = (err: string | null, ok: string) => setMsg(err ?? ok);

  return (
    <>
      <h1 className="gw-title">Donation Contracts</h1>
      <p className="gw-lead">
        Request Naq from guild mates, faction allies, a named commander, or the
        public board. AI rivals post and fulfill requests when it helps them
        grow — pulse the AI if the board looks empty.
      </p>

      <div className="gw-card">
        <h2>Post a request</h2>
        <div className="gw-row">
          <div className="gw-field">
            <label htmlFor="camt">Amount (Naq)</label>
            <input
              id="camt"
              className="gw-input"
              type="number"
              min={MIN_CONTRACT_AMOUNT}
              max={MAX_CONTRACT_AMOUNT}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </div>
          <div className="gw-field">
            <label htmlFor="cscope">Scope</label>
            <select
              id="cscope"
              className="gw-input"
              value={scope}
              onChange={(e) => setScope(e.target.value as ContractScope)}
            >
              <option value="public">Public board</option>
              <option value="guild" disabled={!mine}>
                Guild mates
              </option>
              <option value="faction" disabled={myFaction === "unaligned"}>
                Faction ({FACTIONS[myFaction].name})
              </option>
              <option value="direct">Direct (named)</option>
            </select>
          </div>
          {scope === "direct" && (
            <div className="gw-field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="ctarget">Target</label>
              <select
                id="ctarget"
                className="gw-input"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
              >
                <option value="">Select…</option>
                {(allies.length
                  ? allies
                  : save.realms.filter((r) => r.id !== player.id).slice(0, 80)
                ).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="gw-field" style={{ marginTop: "0.75rem" }}>
          <label htmlFor="cmsg">Message</label>
          <input
            id="cmsg"
            className="gw-input"
            value={message}
            maxLength={120}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="gw-btn"
          style={{ marginTop: "0.85rem" }}
          onClick={() =>
            run(
              requestDonation({
                amount,
                message,
                scope,
                targetId: scope === "direct" ? targetId : null,
              }),
              `Posted request for ${formatNaq(amount)} Naq`,
            )
          }
        >
          Post request
        </button>
        {openMine.length > 0 && (
          <p style={{ color: "var(--gw-muted)", fontSize: "0.85rem" }}>
            You have {openMine.length} open request
            {openMine.length > 1 ? "s" : ""}.
          </p>
        )}
      </div>

      <div className="gw-card">
        <h2>Public board ({publicBoard.length})</h2>
        {publicBoard.length === 0 ? (
          <p style={{ color: "var(--gw-muted)" }}>
            No public requests yet — run an AI pulse from Command Center.
          </p>
        ) : (
          <table className="gw-table">
            <thead>
              <tr>
                <th>From</th>
                <th>Amount</th>
                <th>Message</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {publicBoard.slice(0, 40).map((c) => (
                <tr key={c.id}>
                  <td>
                    <RealmLink realmId={c.requesterId}>
                      {c.requesterName}
                      {c.requesterId === player.id ? " (you)" : ""}
                    </RealmLink>
                  </td>
                  <td>{formatNaq(c.amount)}</td>
                  <td>{c.message}</td>
                  <td>
                    {c.requesterId !== player.id && (
                      <button
                        type="button"
                        className="gw-btn"
                        disabled={player.naquadah < c.amount}
                        onClick={() =>
                          run(
                            fulfillDonation(c.id),
                            `Donated ${formatNaq(c.amount)} to ${c.requesterName}`,
                          )
                        }
                      >
                        Fulfill
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="gw-card">
        <h2>Incoming (guild / faction / direct) ({incoming.length})</h2>
        {incoming.length === 0 ? (
          <p style={{ color: "var(--gw-muted)" }}>
            No private requests aimed at you right now.
          </p>
        ) : (
          <table className="gw-table">
            <thead>
              <tr>
                <th>From</th>
                <th>Scope</th>
                <th>Amount</th>
                <th>Message</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {incoming.map((c) => (
                <tr key={c.id}>
                  <td>
                    <RealmLink realmId={c.requesterId}>
                      {c.requesterName}
                    </RealmLink>
                  </td>
                  <td>{c.scope}</td>
                  <td>{formatNaq(c.amount)}</td>
                  <td>{c.message}</td>
                  <td>
                    <div className="gw-row">
                      <button
                        type="button"
                        className="gw-btn"
                        disabled={player.naquadah < c.amount}
                        onClick={() =>
                          run(
                            fulfillDonation(c.id),
                            `Donated ${formatNaq(c.amount)} to ${c.requesterName}`,
                          )
                        }
                      >
                        Fulfill
                      </button>
                      {c.scope === "direct" && c.targetId === player.id && (
                        <button
                          type="button"
                          className="gw-btn gw-btn-ghost"
                          onClick={() =>
                            run(declineDonation(c.id), "Declined request")
                          }
                        >
                          Decline
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {openMine.length > 0 && (
        <div className="gw-card">
          <h2>Your open requests</h2>
          <table className="gw-table">
            <thead>
              <tr>
                <th>Scope</th>
                <th>Amount</th>
                <th>Message</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {openMine.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.scope}
                    {c.targetName ? (
                      <>
                        {" → "}
                        <RealmLink realmId={c.targetId}>
                          {c.targetName}
                        </RealmLink>
                      </>
                    ) : (
                      ""
                    )}
                  </td>
                  <td>{formatNaq(c.amount)}</td>
                  <td>{c.message}</td>
                  <td>
                    <button
                      type="button"
                      className="gw-btn gw-btn-danger"
                      onClick={() =>
                        run(cancelDonation(c.id), "Cancelled request")
                      }
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="gw-card">
        <h2>Recent history</h2>
        {history.length === 0 ? (
          <p style={{ color: "var(--gw-muted)" }}>No closed contracts yet.</p>
        ) : (
          <table className="gw-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>From</th>
                <th>Amount</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {history.map((c) => (
                <tr key={c.id}>
                  <td>{c.status}</td>
                  <td>
                    <RealmLink realmId={c.requesterId}>
                      {c.requesterName}
                    </RealmLink>
                  </td>
                  <td>{formatNaq(c.amount)}</td>
                  <td>
                    {c.fulfilledByName ? (
                      <RealmLink realmId={c.fulfilledById}>
                        {c.fulfilledByName}
                      </RealmLink>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {msg && <div className="gw-msg">{msg}</div>}
    </>
  );
}
