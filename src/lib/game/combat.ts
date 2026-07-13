import type { AttackLogEntry, Planet, Realm, Units } from "@/lib/db/schema";
import {
  antiCovertAction,
  clamp,
  covertAction,
  defenceAction,
  randBetween,
  strikeAction,
  uid,
} from "@/lib/game/economy";
import {
  clusterDefenceBreakdown,
  effectiveDefencePotential,
} from "@/lib/game/fleetClusters";
import {
  mothershipConquerBonus,
  wearMothershipArmament,
} from "@/lib/game/mothership";
import { pushNews } from "@/lib/game/news";
import {
  canAttemptEradication,
  destroyRealm,
  eradicationChance,
  eradicationPowerRatio,
  ERADICATION_TURN_COST,
  warBetween,
} from "@/lib/game/wars";
import { assertAttackRankRange } from "@/lib/game/rankings";
import type { GameSave } from "@/lib/db/schema";

function emptyLosses(): Partial<Units> {
  return {
    offence: 0,
    defence: 0,
    untrained: 0,
    miners: 0,
    covert: 0,
    antiCovert: 0,
  };
}

function applyCasualties(
  realm: Realm,
  field: keyof Units,
  rate: number,
): number {
  const lost = Math.floor(realm.units[field] * rate);
  realm.units[field] = Math.max(0, realm.units[field] - lost);
  return lost;
}

function wearWeapons(realm: Realm, slot: "attack" | "defence", amount: number) {
  for (const w of realm.weapons) {
    if (w.slot !== slot || w.quantity <= 0) continue;
    w.durability = Math.max(1, w.durability - amount);
    if (w.durability < w.maxDurability * 0.05) {
      w.quantity = Math.max(0, w.quantity - 1);
      w.durability = w.maxDurability;
    }
  }
}

function wearMothership(realm: Realm, amount: number) {
  wearMothershipArmament(realm, amount);
}

export interface AttackResult {
  log: AttackLogEntry;
  attacker: Realm;
  defender: Realm;
}

export function resolveAttack(
  attacker: Realm,
  defender: Realm,
  turnsUsed: number,
  kind: "attack" | "raid" = "attack",
  planets: Planet[] = [],
  save?: GameSave,
): AttackResult {
  if (defender.dead) throw new Error("Target realm is destroyed");
  if (attacker.dead) throw new Error("Your realm is destroyed");
  const turns = clamp(Math.floor(turnsUsed), 1, 15);
  if (attacker.attackTurns < turns) {
    throw new Error("Not enough attack turns");
  }
  if (defender.vacation) {
    throw new Error("Target is in vacation mode");
  }
  if (save) assertAttackRankRange(save, attacker.id, defender.id);

  attacker.attackTurns -= turns;

  const atkPotential = strikeAction(attacker, planets);
  const clusterInfo = save
    ? clusterDefenceBreakdown(save, defender, planets)
    : null;
  const defPotential = save
    ? effectiveDefencePotential(defender, planets, save)
    : defenceAction(defender, planets);
  const atkRoll = atkPotential * randBetween(0.75, 1);
  const defRoll = defPotential * randBetween(0.75, 1);
  const won = atkRoll > defRoll;

  const attackerLosses = emptyLosses();
  const defenderLosses = emptyLosses();
  let naqStolen = 0;
  let uuStolen = 0;

  const disparity =
    Math.max(atkRoll, defRoll) / Math.max(1, Math.min(atkRoll, defRoll));
  const casualtySide = disparity >= 1.2;

  if (casualtySide) {
    const baseRate = clamp(0.01 * turns * (disparity - 1), 0.01, 0.12);
    if (won) {
      attackerLosses.offence = applyCasualties(attacker, "offence", baseRate * 0.4);
      defenderLosses.defence = applyCasualties(defender, "defence", baseRate);
    } else {
      attackerLosses.offence = applyCasualties(attacker, "offence", baseRate);
      defenderLosses.defence = applyCasualties(
        defender,
        "defence",
        baseRate * 0.35,
      );
    }
  }

  wearWeapons(attacker, "attack", 2 + turns);
  wearWeapons(defender, "defence", won ? 3 + turns : 1);
  wearMothership(attacker, turns * 2);
  wearMothership(defender, won ? turns * 3 : turns);

  if (won) {
    if (kind === "attack") {
      const pool = defender.naquadah * 0.75;
      const pct = randBetween(0.6, 1) * (turns / 15);
      naqStolen = Math.floor(pool * pct);
      defender.naquadah -= naqStolen;
      attacker.naquadah += naqStolen;
    } else {
      const pool = defender.units.untrained;
      const pct = randBetween(0.05, 0.2) * (turns / 15);
      uuStolen = Math.floor(pool * pct);
      defender.units.untrained -= uuStolen;
      attacker.units.untrained += uuStolen;
    }

    if (kind === "attack") {
      const ac = antiCovertAction(attacker);
      const cov = covertAction(defender);
      if (ac > cov * 0.5 && defender.units.covert > 0) {
        const kill = Math.max(
          1,
          Math.floor(
            defender.units.covert *
              clamp(ac / Math.max(1, cov) * 0.05, 0.01, 0.2),
          ),
        );
        defender.units.covert = Math.max(0, defender.units.covert - kill);
        defenderLosses.covert = (defenderLosses.covert ?? 0) + kill;
      }
    }
  }

  attacker.attackFatigue = clamp(attacker.attackFatigue + turns * 1.5, 0, 50);
  defender.defenceAlert = clamp(defender.defenceAlert + turns * 2, 0, 50);

  const summary = won
    ? kind === "attack"
      ? `Victory — seized ${naqStolen.toLocaleString()} Naq`
      : `Raid success — took ${uuStolen.toLocaleString()} UU`
    : clusterInfo && clusterInfo.members.length > 1
      ? `Defeat — fleets clustered (${clusterInfo.members.length}) repelled the assault`
      : `Defeat — forces repelled`;

  const log: AttackLogEntry = {
    id: uid("atk"),
    at: Date.now(),
    attackerId: attacker.id,
    defenderId: defender.id,
    attackerName: attacker.name,
    defenderName: defender.name,
    turnsUsed: turns,
    won,
    naqStolen,
    uuStolen,
    attackerLosses,
    defenderLosses,
    kind,
    summary,
  };
  if (clusterInfo && clusterInfo.members.length > 1) {
    log.clusterSize = clusterInfo.members.length;
    log.clusterDefence = clusterInfo.total;
  }

  // Kill move: after a winning attack, roll eradication if ≥10× power
  if (save && won && !defender.dead) {
    const ratio = eradicationPowerRatio(attacker, defender, planets, save);
    const chance = eradicationChance(ratio);
    if (chance > 0) {
      log.eradicationAttempted = true;
      log.eradicationChance = chance;
      if (Math.random() < chance) {
        const war =
          attacker.allianceId && defender.allianceId
            ? warBetween(save, attacker.allianceId, defender.allianceId)
            : undefined;
        destroyRealm(save, defender, attacker, { warId: war?.id });
        log.eradicated = true;
        log.summary = `${summary} — ERADICATED (${Math.round(chance * 100)}% roll)`;
        pushNews(
          save,
          "destruction",
          `${attacker.name} eradicated ${defender.name} (${Math.round(chance * 100)}% at ${ratio.toFixed(0)}× power)`,
        );
      } else {
        log.eradicated = false;
        log.summary = `${summary} — eradication failed (${Math.round(chance * 100)}%)`;
        pushNews(
          save,
          "attack",
          `${attacker.name} struck ${defender.name} — ${log.summary}`,
        );
      }
    } else {
      pushNews(
        save,
        "attack",
        `${attacker.name} struck ${defender.name} — ${summary}`,
      );
    }
  } else if (save) {
    pushNews(
      save,
      "attack",
      won
        ? `${attacker.name} struck ${defender.name} — ${summary}`
        : `${defender.name} repelled ${attacker.name}`,
    );
  }

  return { log, attacker, defender };
}

/**
 * Dedicated eradication attempt — costs turns, no loot.
 * Requires ≥10× strike vs defence; chance = 5% per 10× tier.
 */
export function resolveEradication(
  attacker: Realm,
  defender: Realm,
  planets: Planet[] = [],
  save?: GameSave,
): AttackResult {
  if (defender.dead) throw new Error("Target realm is destroyed");
  if (attacker.dead) throw new Error("Your realm is destroyed");
  if (defender.vacation) throw new Error("Target is in vacation mode");
  if (save) assertAttackRankRange(save, attacker.id, defender.id);
  if (!canAttemptEradication(attacker, defender, planets, save)) {
    throw new Error("Need at least 10× their defence power to eradicate");
  }
  if (attacker.attackTurns < ERADICATION_TURN_COST) {
    throw new Error(`Need ${ERADICATION_TURN_COST} attack turns to eradicate`);
  }

  attacker.attackTurns -= ERADICATION_TURN_COST;
  attacker.attackFatigue = clamp(attacker.attackFatigue + 12, 0, 50);

  const ratio = eradicationPowerRatio(attacker, defender, planets, save);
  const chance = eradicationChance(ratio);
  const success = Math.random() < chance;
  const clusterInfo = save
    ? clusterDefenceBreakdown(save, defender, planets)
    : null;

  const log: AttackLogEntry = {
    id: uid("erd"),
    at: Date.now(),
    attackerId: attacker.id,
    defenderId: defender.id,
    attackerName: attacker.name,
    defenderName: defender.name,
    turnsUsed: ERADICATION_TURN_COST,
    won: success,
    naqStolen: 0,
    uuStolen: 0,
    attackerLosses: emptyLosses(),
    defenderLosses: emptyLosses(),
    kind: "eradicate",
    eradicationAttempted: true,
    eradicationChance: chance,
    eradicated: success,
    summary: success
      ? `ERADICATED ${defender.name} (${Math.round(chance * 100)}% at ${ratio.toFixed(0)}×)`
      : `Eradication failed — ${defender.name} endured (${Math.round(chance * 100)}% at ${ratio.toFixed(0)}×)`,
  };
  if (clusterInfo && clusterInfo.members.length > 1) {
    log.clusterSize = clusterInfo.members.length;
    log.clusterDefence = clusterInfo.total;
  }

  if (save) {
    if (success) {
      const war =
        attacker.allianceId && defender.allianceId
          ? warBetween(save, attacker.allianceId, defender.allianceId)
          : undefined;
      destroyRealm(save, defender, attacker, { warId: war?.id });
      pushNews(
        save,
        "destruction",
        `${attacker.name} eradicated ${defender.name} (${Math.round(chance * 100)}% at ${ratio.toFixed(0)}× power)`,
      );
    } else {
      pushNews(
        save,
        "attack",
        `${attacker.name} failed to eradicate ${defender.name} (${Math.round(chance * 100)}%)`,
      );
    }
  }

  return { log, attacker, defender };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function resolvePlanetConquer(
  attacker: Realm,
  planet: Planet,
  planets: Planet[],
  now = Date.now(),
): AttackLogEntry {
  if (attacker.attackTurns < 5) {
    throw new Error("Need at least 5 attack turns to conquer a planet");
  }
  if (attacker.mothership.tier < 1) {
    throw new Error("A mothership is required to conquer planets");
  }
  if (planet.ownerId === attacker.id) {
    throw new Error("You already control this planet");
  }
  if (
    attacker.lastPlanetConquerAt &&
    now - attacker.lastPlanetConquerAt < DAY_MS
  ) {
    throw new Error("You can only conquer one planet per day");
  }

  const owner = planet.ownerId;
  attacker.attackTurns -= 5;

  const fleet =
    strikeAction(attacker, planets) * 0.35 +
    attacker.mothership.power +
    mothershipConquerBonus(attacker);
  const defence =
    planet.defenceRating +
    (planet.ownerId ? planet.defenceRating * 0.25 : 0);
  const atkRoll = fleet * randBetween(0.8, 1);
  const defRoll = defence * randBetween(0.85, 1);
  const won = atkRoll > defRoll;

  const attackerLosses = emptyLosses();
  if (!won) {
    attackerLosses.offence = applyCasualties(attacker, "offence", 0.08);
    wearMothership(attacker, Math.ceil(attacker.mothership.maxHull * 0.15));
  } else {
    attackerLosses.offence = applyCasualties(attacker, "offence", 0.03);
    wearMothership(attacker, Math.ceil(attacker.mothership.maxHull * 0.05));
    planet.ownerId = attacker.id;
    planet.conqueredAt = now;
    attacker.lastPlanetConquerAt = now;
  }

  attacker.attackFatigue = clamp(attacker.attackFatigue + 8, 0, 50);

  return {
    id: uid("planet"),
    at: now,
    attackerId: attacker.id,
    defenderId: owner ?? "neutral",
    attackerName: attacker.name,
    defenderName: planet.name,
    turnsUsed: 5,
    won,
    naqStolen: 0,
    uuStolen: 0,
    attackerLosses,
    defenderLosses: emptyLosses(),
    kind: "planet",
    planetId: planet.id,
    planetName: planet.name,
    summary: won
      ? `Conquered ${planet.name} (+${planet.miningYield} Naq/turn, +${planet.upYield} UU/turn)`
      : `Failed to take ${planet.name} — fleet damaged`,
  };
}
