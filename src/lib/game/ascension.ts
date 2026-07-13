import type { RaceId, Realm, GameSave } from "@/lib/db/schema";
import {
  DEFAULT_TECH,
  EMPTY_MOTHERSHIP,
} from "@/lib/db/schema";
import { starterWeapons } from "@/lib/game/races";
import { ensureTech, ascensionCombatBonus, ascensionIncomeBonus } from "@/lib/game/economy";

export { ascensionCombatBonus, ascensionIncomeBonus };

/** Local sandbox threshold (classic Main uses 1001). */
export const ASCENSION_GR_REQUIRED = 101;

export const ASCENDED_RACE_TITLE: Record<RaceId, string> = {
  asgard: "Ancients",
  goauld: "System Lords",
  replicator: "Nano Ti Masters",
  tauri: "Tollan",
};

export interface AscensionRequirements {
  gloryNeeded: number;
  gloryHave: number;
  gloryOk: boolean;
  minUp: number;
  upOk: boolean;
  untrainedNeeded: number;
  untrainedHave: number;
  untrainedOk: boolean;
  trainedNeeded: number;
  trainedHave: number;
  trainedOk: boolean;
  naqNeeded: number;
  naqHave: number;
  naqOk: boolean;
  ready: boolean;
  nextLevel: number;
  estimatedAp: number;
}

function trainedCombatUnits(realm: Realm): number {
  return (
    realm.units.offence +
    realm.units.defence +
    realm.units.covert +
    realm.units.antiCovert
  );
}

export function ascensionRequirements(realm: Realm): AscensionRequirements {
  const nextLevel = (realm.ascensionLevel ?? 0) + 1;
  const up = Math.max(1, realm.unitProductionLevel);
  const minUp = 5 + (realm.ascensionLevel ?? 0) * 2;
  const untrainedNeeded = Math.floor(up * 25);
  const trainedNeeded = Math.floor(up * 10);
  const naqNeeded = Math.floor(up * 250 * (1 + (realm.ascensionLevel ?? 0) * 0.15));

  const gloryHave = realm.gloryReputation ?? 0;
  const untrainedHave = realm.units.untrained;
  const trainedHave = trainedCombatUnits(realm);
  const naqHave = realm.naquadah + realm.bankNaquadah;

  const gloryOk = gloryHave >= ASCENSION_GR_REQUIRED;
  const upOk = up >= minUp;
  const untrainedOk = untrainedHave >= untrainedNeeded;
  const trainedOk = trainedHave >= trainedNeeded;
  const naqOk = naqHave >= naqNeeded;

  return {
    gloryNeeded: ASCENSION_GR_REQUIRED,
    gloryHave,
    gloryOk,
    minUp,
    upOk,
    untrainedNeeded,
    untrainedHave,
    untrainedOk,
    trainedNeeded,
    trainedHave,
    trainedOk,
    naqNeeded,
    naqHave,
    naqOk,
    ready: gloryOk && upOk && untrainedOk && trainedOk && naqOk,
    nextLevel,
    estimatedAp: estimateAscensionPoints(realm),
  };
}

/** Convert sacrificed realm mass into Ascension Points. */
export function estimateAscensionPoints(realm: Realm): number {
  const tech = ensureTech(realm);
  const techSum =
    tech.general +
    tech.mining +
    tech.offence +
    tech.defence +
    tech.covert +
    tech.equipment;
  const weapons = realm.weapons.reduce(
    (s, w) => s + w.quantity * w.power,
    0,
  );
  const units =
    realm.units.untrained +
    trainedCombatUnits(realm) +
    (realm.units.miners ?? 0) * 0.25;
  const naq = realm.naquadah + realm.bankNaquadah;
  const up = realm.unitProductionLevel;
  const spy = realm.spyLevel + realm.antiSpyLevel;
  const ms = realm.mothership?.tier ?? 0;

  const raw =
    up * 12 +
    techSum * 8 +
    spy * 6 +
    weapons * 0.04 +
    units * 0.08 +
    naq * 0.002 +
    ms * 40 +
    (realm.ascensionLevel ?? 0) * 25;

  return Math.max(10, Math.floor(raw));
}

/**
 * Perform ascension: sacrifice most of the realm, keep miners / mothership /
 * planets, evolve title, bank AP, soft-reset for the next climb.
 */
export function performAscension(realm: Realm): {
  apGained: number;
  title: string;
} {
  const req = ascensionRequirements(realm);
  if (!req.ready) {
    throw new Error("Ascension requirements not met");
  }

  const apGained = estimateAscensionPoints(realm);
  const miners = realm.units.miners ?? 0;
  const mothership = realm.mothership
    ? { ...realm.mothership }
    : { ...EMPTY_MOTHERSHIP };
  const race = realm.race;
  const nextLevel = (realm.ascensionLevel ?? 0) + 1;
  const title = ASCENDED_RACE_TITLE[race];

  // Soft reset — keep miners (lifers), mothership, planets (via ownerId), AP
  realm.ascensionLevel = nextLevel;
  realm.ascensionPoints = (realm.ascensionPoints ?? 0) + apGained;
  realm.ascendedTitle = title;
  realm.gloryReputation = Math.max(
    0,
    (realm.gloryReputation ?? 0) - ASCENSION_GR_REQUIRED,
  );

  realm.naquadah = 500 + apGained * 2;
  realm.bankNaquadah = 0;
  realm.bankLevel = Math.max(1, Math.floor(realm.bankLevel * 0.5));
  realm.unitProductionLevel = Math.max(
    3,
    Math.floor(5 + nextLevel * 2 + apGained * 0.05),
  );
  realm.spyLevel = Math.max(1, Math.floor(1 + nextLevel));
  realm.antiSpyLevel = Math.max(1, Math.floor(1 + nextLevel));
  realm.tech = {
    ...DEFAULT_TECH,
    general: 1 + Math.min(3, nextLevel),
    mining: 1 + Math.min(2, nextLevel),
    offence: 1 + Math.min(2, nextLevel),
    defence: 1 + Math.min(2, nextLevel),
    covert: 1 + Math.min(2, nextLevel),
    equipment: 1 + Math.min(2, nextLevel),
  };
  realm.techLevel = realm.tech.general;
  realm.units = {
    untrained: 40 + nextLevel * 10,
    miners,
    offence: 5 + nextLevel * 2,
    defence: 5 + nextLevel * 2,
    covert: 3 + nextLevel,
    antiCovert: 3 + nextLevel,
  };
  realm.weapons = starterWeapons(race).map((w) => ({
    ...w,
    quantity: w.techReq <= 1 && w.power <= 10 ? 2 + nextLevel : 0,
  }));
  realm.mothership = mothership;
  realm.defenceAlert = 0;
  realm.attackFatigue = 0;
  realm.attackTurns = 20;
  realm.covertCapacity = 8;

  return { apGained, title };
}

export function displayRaceName(realm: Realm): string {
  if ((realm.ascensionLevel ?? 0) > 0 && realm.ascendedTitle) {
    return `${realm.ascendedTitle}`;
  }
  return "";
}

export function canSeeAscensionPanel(realm: Realm): boolean {
  return (realm.gloryReputation ?? 0) >= ASCENSION_GR_REQUIRED * 0.5;
}

export function spendAscensionPoints(
  save: GameSave,
  realmId: string,
  amount: number,
  sink: "up" | "naq" | "tech",
): string | null {
  const realm = save.realms.find((r) => r.id === realmId);
  if (!realm) return "Realm not found";
  const cost = Math.floor(amount);
  if (cost < 1) return "Invalid amount";
  if ((realm.ascensionPoints ?? 0) < cost) return "Not enough Ascension Points";

  realm.ascensionPoints -= cost;
  if (sink === "up") {
    realm.unitProductionLevel += Math.max(1, Math.floor(cost / 15));
  } else if (sink === "naq") {
    realm.naquadah += cost * 40;
  } else {
    const tech = ensureTech(realm);
    const bumps = Math.max(1, Math.floor(cost / 20));
    tech.general += bumps;
    tech.mining += Math.floor(bumps / 2);
    realm.techLevel = tech.general;
  }
  return null;
}
