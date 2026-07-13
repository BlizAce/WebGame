import type { IntelLogEntry, Realm } from "@/lib/db/schema";
import {
  antiCovertAction,
  clamp,
  covertAction,
  defenceAction,
  randBetween,
  strikeAction,
  uid,
} from "@/lib/game/economy";

const COVERT_COST = 1;

export function resolveSpy(
  actor: Realm,
  target: Realm,
  agentsSent: number,
): { log: IntelLogEntry; actor: Realm; target: Realm } {
  if (actor.covertCapacity < COVERT_COST) {
    throw new Error("Not enough covert capacity");
  }
  const sent = clamp(Math.floor(agentsSent), 1, actor.units.covert);
  if (sent < 1) throw new Error("No covert agents to send");

  actor.covertCapacity -= COVERT_COST;

  const cov = covertAction(actor) * (sent / Math.max(1, actor.units.covert));
  const anti = antiCovertAction(target);
  const roll = cov * randBetween(0.9, 1);
  const success = roll > anti * randBetween(0.85, 1);

  let detected = false;
  let details = "";
  let revealed: IntelLogEntry["revealed"];

  if (!success) {
    const lost = Math.max(1, Math.floor(sent * 0.35));
    actor.units.covert = Math.max(0, actor.units.covert - lost);
    detected = true;
    details = `Spy failed. Lost ${lost} agents. Detected.`;
  } else {
    const lost = Math.floor(sent * 0.02);
    if (lost > 0) actor.units.covert = Math.max(0, actor.units.covert - lost);
    detected = target.defenceAlert > 25 && Math.random() < 0.25;
    revealed = {
      naquadah: Math.random() < 0.7 ? target.naquadah : undefined,
      defenceAction: Math.random() < 0.65 ? defenceAction(target) : undefined,
      strikeAction: Math.random() < 0.5 ? strikeAction(target) : undefined,
      units: Math.random() < 0.55 ? { ...target.units } : undefined,
      weapons:
        Math.random() < 0.5
          ? target.weapons.reduce((s, w) => s + w.quantity, 0)
          : undefined,
    };
    // strip undefined
    revealed = Object.fromEntries(
      Object.entries(revealed).filter(([, v]) => v !== undefined),
    ) as IntelLogEntry["revealed"];
    details = detected
      ? "Recon succeeded but you were noticed."
      : "Recon succeeded quietly.";
  }

  const log: IntelLogEntry = {
    id: uid("intel"),
    at: Date.now(),
    actorId: actor.id,
    targetId: target.id,
    actorName: actor.name,
    targetName: target.name,
    kind: "spy",
    success,
    detected,
    details,
    revealed,
  };

  return { log, actor, target };
}

export function resolveSabotage(
  actor: Realm,
  target: Realm,
  agentsSent: number,
): { log: IntelLogEntry; actor: Realm; target: Realm } {
  if (actor.covertCapacity < COVERT_COST) {
    throw new Error("Not enough covert capacity");
  }
  const sent = clamp(Math.floor(agentsSent), 1, actor.units.covert);
  if (sent < 1) throw new Error("No covert agents to send");

  actor.covertCapacity -= COVERT_COST;

  const cov = covertAction(actor) * randBetween(0.9, 1);
  const anti = antiCovertAction(target) * randBetween(0.95, 1);
  const success = cov > anti;

  let destroyed = 0;
  let details = "";

  if (!success) {
    const lost = Math.max(1, Math.floor(sent * 0.5));
    actor.units.covert = Math.max(0, actor.units.covert - lost);
    details = `Sabotage failed. Lost ${lost} agents.`;
  } else {
    const lost = Math.max(1, Math.floor(sent * randBetween(0.05, 0.25)));
    actor.units.covert = Math.max(0, actor.units.covert - lost);

    const sorted = [...target.weapons]
      .filter((w) => w.quantity > 0)
      .sort((a, b) => a.power - b.power);
    const maxDestroy = Math.max(
      1,
      Math.floor(sorted.reduce((s, w) => s + w.quantity, 0) * 0.02),
    );
    let budget = maxDestroy;
    for (const w of sorted) {
      if (budget <= 0) break;
      const take = Math.min(w.quantity, budget);
      w.quantity -= take;
      destroyed += take;
      budget -= take;
    }
    details = `Sabotage hit — destroyed ${destroyed} weapon(s). Lost ${lost} agents.`;
  }

  const detected =
    !success ||
    (target.units.covert * 10 >= cov * 0.5 && Math.random() < 0.1);

  const log: IntelLogEntry = {
    id: uid("intel"),
    at: Date.now(),
    actorId: actor.id,
    targetId: target.id,
    actorName: actor.name,
    targetName: target.name,
    kind: "sabotage",
    success,
    detected,
    details,
  };

  return { log, actor, target };
}

export function resolveAssassinate(
  actor: Realm,
  target: Realm,
  agentsSent: number,
): { log: IntelLogEntry; actor: Realm; target: Realm } {
  if (actor.covertCapacity < COVERT_COST) {
    throw new Error("Not enough covert capacity");
  }
  const sent = clamp(Math.floor(agentsSent), 1, actor.units.covert);
  if (sent < 1) throw new Error("No covert agents to send");

  actor.covertCapacity -= COVERT_COST;

  const cov = covertAction(actor) * randBetween(0.8, 1);
  const anti = antiCovertAction(target) * randBetween(0.85, 1);
  const success = cov > anti;

  let details = "";
  if (!success) {
    const lost = Math.max(1, Math.floor(sent * (anti / Math.max(1, cov)) * 0.2));
    actor.units.covert = Math.max(0, actor.units.covert - lost);
    details = `Assassination failed. Lost ${lost} agents. Target alerted.`;
  } else {
    const atkLoss = Math.max(
      1,
      Math.floor(sent * clamp(anti / Math.max(1, cov), 0.05, 0.4)),
    );
    const defSpyLoss = Math.max(
      1,
      Math.floor(target.units.covert * clamp(cov / Math.max(1, anti) * 0.1, 0.05, 0.3)),
    );
    const defAntiLoss = Math.max(1, Math.floor(defSpyLoss * 0.5));
    actor.units.covert = Math.max(0, actor.units.covert - atkLoss);
    target.units.covert = Math.max(0, target.units.covert - defSpyLoss);
    target.units.antiCovert = Math.max(0, target.units.antiCovert - defAntiLoss);
    details = `Assassins struck — enemy lost ${defSpyLoss} spies & ${defAntiLoss} anti-spies. You lost ${atkLoss}.`;
  }

  const log: IntelLogEntry = {
    id: uid("intel"),
    at: Date.now(),
    actorId: actor.id,
    targetId: target.id,
    actorName: actor.name,
    targetName: target.name,
    kind: "assassinate",
    success,
    detected: true,
    details,
  };

  return { log, actor, target };
}
