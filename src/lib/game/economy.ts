import type {
  RaceId,
  Realm,
  TechTree,
  WeaponStack,
  Planet,
  Units,
} from "@/lib/db/schema";
import { RACES } from "@/lib/game/races";
import {
  mothershipDefenceBonus,
  mothershipStats,
  mothershipUpgradeCost,
} from "@/lib/game/mothership";

export {
  mothershipStats,
  mothershipUpgradeCost,
  mothershipPartUpgradeCost,
  mothershipCapacityUpgradeCost,
  mothershipArmamentUnitCost,
  upgradeMothershipPart,
  expandMothershipCapacity,
  installMothershipArmament,
  ensureMothershipParts,
  recomputeMothership,
  MOTHERSHIP_PART_META,
  MOTHERSHIP_PART_IDS,
  MOTHERSHIP_MODULE_IDS,
  MOTHERSHIP_MAX_TIER,
  mothershipConquerBonus,
  mothershipDefenceBonus,
} from "@/lib/game/mothership";
export type { MothershipPartId } from "@/lib/db/schema";
export type {
  MothershipModuleId,
  MothershipArmamentKind,
} from "@/lib/game/mothership";

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** Hard ceiling for attack turns (regen + market buys). */
export const MAX_ATTACK_TURNS = 2000;

/** Attack turns gained each game tick. */
export const ATTACK_TURNS_PER_TICK = 2;

export function randBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export function ascensionCombatBonus(realm: Realm): number {
  const ap = realm.ascensionPoints ?? 0;
  const lvl = realm.ascensionLevel ?? 0;
  return 1 + lvl * 0.06 + Math.min(0.4, ap * 0.0008);
}

export function ascensionIncomeBonus(realm: Realm): number {
  const ap = realm.ascensionPoints ?? 0;
  const lvl = realm.ascensionLevel ?? 0;
  return 1 + lvl * 0.05 + Math.min(0.35, ap * 0.0006);
}

export function ensureTech(realm: Realm): TechTree {
  if (!realm.tech) {
    realm.tech = {
      general: realm.techLevel || 1,
      mining: 1,
      offence: 1,
      defence: 1,
      covert: 1,
      equipment: 1,
    };
  }
  return realm.tech;
}

export function ownedPlanets(realm: Realm, planets: Planet[]): Planet[] {
  return planets.filter((p) => p.ownerId === realm.id);
}

/** Origins-style income + mining tech + miners + planets */
export function incomePerTurn(
  realm: Realm,
  planets: Planet[] = [],
  socialIncomeMult = 1,
): number {
  const race = RACES[realm.race];
  const tech = ensureTech(realm);
  const alertFactor = 1 - realm.defenceAlert / 50;
  const fatigueFactor = 1 - realm.attackFatigue / 50;
  const miningMult = 1 + (tech.mining - 1) * 0.12;

  const fromUu = realm.units.untrained * 4;
  const fromMiners = (realm.units.miners ?? 0) * 14;
  const fromDef = realm.units.defence * 8 * alertFactor;
  const fromAtk = realm.units.offence * 8 * fatigueFactor;
  const fromPlanets = ownedPlanets(realm, planets).reduce(
    (s, p) => s + p.miningYield,
    0,
  );

  const raw =
    (fromUu + fromMiners + fromDef + fromAtk) * miningMult + fromPlanets;
  return Math.floor(
    raw *
      (1 + race.incomeBonus) *
      ascensionIncomeBonus(realm) *
      socialIncomeMult,
  );
}

export function uuPerTurn(
  realm: Realm,
  planets: Planet[] = [],
  guildUpFlat = 0,
): number {
  const fromUp = Math.max(1, Math.floor(3 + realm.unitProductionLevel * 2.5));
  const fromPlanets = ownedPlanets(realm, planets).reduce(
    (s, p) => s + p.upYield,
    0,
  );
  return fromUp + fromPlanets + Math.max(0, Math.floor(guildUpFlat));
}

export function bankCapacity(realm: Realm, planets: Planet[] = []): number {
  const tip = Math.max(incomePerTurn(realm, planets), 20);
  return Math.floor(tip * 48 * 1.5 * (1 + realm.bankLevel * 0.35));
}

export function depositFeeRate(race: RaceId): number {
  return RACES[race].freeBanking ? 0 : 0.05;
}

export function upUpgradeCost(level: number): number {
  return Math.floor(500 * Math.pow(1.45, level - 1));
}

export function spyUpgradeCost(level: number): number {
  return Math.floor(400 * Math.pow(1.5, level - 1));
}

export function antiSpyUpgradeCost(level: number): number {
  return Math.floor(400 * Math.pow(1.5, level - 1));
}

export type TechBranch = keyof TechTree;

export function techBranchCost(branch: TechBranch, level: number): number {
  const base: Record<TechBranch, number> = {
    general: 750,
    mining: 600,
    offence: 650,
    defence: 650,
    covert: 700,
    equipment: 800,
  };
  const growth: Record<TechBranch, number> = {
    general: 1.55,
    mining: 1.48,
    offence: 1.5,
    defence: 1.5,
    covert: 1.52,
    equipment: 1.58,
  };
  return Math.floor(base[branch] * Math.pow(growth[branch], level - 1));
}

/** @deprecated use techBranchCost('general', level) */
export function techUpgradeCost(level: number): number {
  return techBranchCost("general", level);
}

export function bankUpgradeCost(level: number): number {
  return Math.floor(300 * Math.pow(1.4, level - 1));
}

export function trainCost(kind: keyof Units): number {
  switch (kind) {
    case "miners":
      return 20;
    case "offence":
    case "defence":
      return 25;
    case "covert":
    case "antiCovert":
      return 40;
    default:
      return 0;
  }
}

export function maxTrainAmount(realm: Realm, kind: keyof Units): number {
  if (kind === "untrained") return 0;
  const cost = trainCost(kind);
  if (cost <= 0) return 0;
  return Math.min(realm.units.untrained, Math.floor(realm.naquadah / cost));
}

export function maxBuyWeaponAmount(realm: Realm, weapon: WeaponStack): number {
  const tech = ensureTech(realm);
  if (tech.equipment < (weapon.techReq ?? 1)) return 0;
  if (weapon.buyCost <= 0) return 0;
  return Math.floor(realm.naquadah / weapon.buyCost);
}

export function weaponPowerSum(weapons: WeaponStack[], slot: "attack" | "defence") {
  return weapons
    .filter((w) => w.slot === slot && w.quantity > 0)
    .reduce((sum, w) => {
      const ratio = w.durability / w.maxDurability;
      return sum + w.power * w.quantity * ratio;
    }, 0);
}

export function strikeAction(
  realm: Realm,
  planets: Planet[] = [],
  socialCombatMult = 1,
  opts?: { planetCount?: number },
): number {
  const race = RACES[realm.race];
  const tech = ensureTech(realm);
  const armed = Math.min(realm.units.offence, totalQty(realm.weapons, "attack"));
  const unarmed = Math.max(0, realm.units.offence - armed);
  const weapon =
    weaponPowerSum(realm.weapons, "attack") * (1 + (tech.equipment - 1) * 0.1);
  const unitPower = 12 * (1 + (tech.offence - 1) * 0.1);
  const base = armed * unitPower + unarmed * 2 + weapon * 1.2;
  const general = 1 + (tech.general - 1) * 0.08;
  const ms = realm.mothership?.power ?? 0;
  const planetN =
    opts?.planetCount ?? ownedPlanets(realm, planets).length;
  const planetBoost = 1 + planetN * 0.03;
  return Math.floor(
    (base * general + ms) *
      (1 + race.attackBonus) *
      planetBoost *
      ascensionCombatBonus(realm) *
      socialCombatMult,
  );
}

export function defenceAction(
  realm: Realm,
  planets: Planet[] = [],
  socialCombatMult = 1,
  opts?: { planetCount?: number },
): number {
  const race = RACES[realm.race];
  const tech = ensureTech(realm);
  const armed = Math.min(realm.units.defence, totalQty(realm.weapons, "defence"));
  const unarmed = Math.max(0, realm.units.defence - armed);
  const weapon =
    weaponPowerSum(realm.weapons, "defence") * (1 + (tech.equipment - 1) * 0.1);
  const unitPower = 12 * (1 + (tech.defence - 1) * 0.1);
  const base = armed * unitPower + unarmed * 2 + weapon * 1.2;
  const general = 1 + (tech.general - 1) * 0.08;
  const alertBonus = 1 + realm.defenceAlert * 0.004;
  const ms = mothershipDefenceBonus(realm);
  const planetN =
    opts?.planetCount ?? ownedPlanets(realm, planets).length;
  const planetBoost = 1 + planetN * 0.04;
  return Math.floor(
    (base * general + ms) *
      (1 + race.defenceBonus) *
      alertBonus *
      planetBoost *
      ascensionCombatBonus(realm) *
      socialCombatMult,
  );
}

export function mothershipAction(realm: Realm): number {
  return realm.mothership?.power ?? 0;
}

export function covertAction(realm: Realm): number {
  const tech = ensureTech(realm);
  const mult = 1 + realm.spyLevel * 0.15;
  const branch = 1 + (tech.covert - 1) * 0.1;
  const general = 1 + (tech.general - 1) * 0.03;
  return Math.floor(realm.units.covert * 10 * mult * branch * general);
}

export function antiCovertAction(realm: Realm): number {
  const tech = ensureTech(realm);
  const mult = 1 + realm.antiSpyLevel * 0.15;
  const branch = 1 + (tech.covert - 1) * 0.1;
  const general = 1 + (tech.general - 1) * 0.03;
  return Math.floor(realm.units.antiCovert * 10 * mult * branch * general);
}

function totalQty(weapons: WeaponStack[], slot: "attack" | "defence") {
  return weapons
    .filter((w) => w.slot === slot)
    .reduce((s, w) => s + w.quantity, 0);
}

export function overallRankScore(
  realm: Realm,
  planets: Planet[] = [],
  socialCombatMult = 1,
  opts?: { planetCount?: number },
): number {
  return (
    strikeAction(realm, planets, socialCombatMult, opts) +
    defenceAction(realm, planets, socialCombatMult, opts) +
    covertAction(realm) +
    antiCovertAction(realm) +
    mothershipAction(realm)
  );
}

/** Exact locale string (tables / tooltips when you need every digit). */
export function formatNaqExact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1e15) {
    // Beyond safe-integer range — scientific is more honest than fake digits
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return Math.floor(n).toLocaleString();
}

/**
 * Compact display for UI — short suffixes so late-game Naq doesn't blow the layout.
 * Under 1M: full locale. Then M B T Q Qi Sx Sp Oc No Dc … then scientific.
 */
const NAQ_SUFFIXES: { exp: number; suffix: string }[] = [
  { exp: 6, suffix: "M" }, // million
  { exp: 9, suffix: "B" }, // billion
  { exp: 12, suffix: "T" }, // trillion
  { exp: 15, suffix: "Q" }, // quadrillion
  { exp: 18, suffix: "Qi" }, // quintillion
  { exp: 21, suffix: "Sx" }, // sextillion
  { exp: 24, suffix: "Sp" }, // septillion
  { exp: 27, suffix: "Oc" }, // octillion
  { exp: 30, suffix: "No" }, // nonillion
  { exp: 33, suffix: "Dc" }, // decillion
  { exp: 36, suffix: "Ud" }, // undecillion
  { exp: 39, suffix: "Dd" }, // duodecillion
  { exp: 42, suffix: "Td" }, // tredecillion
  { exp: 45, suffix: "Qd" }, // quattuordecillion
  { exp: 48, suffix: "Qq" }, // quindecillion
  { exp: 51, suffix: "Sg" }, // sexdecillion
  { exp: 54, suffix: "St" }, // septendecillion
  { exp: 57, suffix: "Og" }, // octodecillion
  { exp: 60, suffix: "Ng" }, // novemdecillion
  { exp: 63, suffix: "Vg" }, // vigintillion
  { exp: 66, suffix: "Uv" },
  { exp: 69, suffix: "Dv" },
  { exp: 72, suffix: "Tv" },
  { exp: 75, suffix: "Qv" },
  { exp: 78, suffix: "Qiv" },
  { exp: 81, suffix: "Sxv" },
  { exp: 84, suffix: "Spv" },
  { exp: 87, suffix: "Ocv" },
  { exp: 90, suffix: "Nov" },
  { exp: 93, suffix: "Tg" }, // trigintillion-ish
  { exp: 96, suffix: "UTg" },
  { exp: 99, suffix: "DTg" },
  { exp: 102, suffix: "TTg" },
  { exp: 105, suffix: "QaTg" },
  { exp: 108, suffix: "QiTg" },
  { exp: 111, suffix: "SxTg" },
  { exp: 114, suffix: "SpTg" },
  { exp: 117, suffix: "OcTg" },
  { exp: 120, suffix: "NoTg" },
];

export function formatNaq(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs < 1_000_000) return sign + Math.floor(abs).toLocaleString();

  // log10 path stays accurate far past Number.MAX_SAFE_INTEGER
  const exp = Math.floor(Math.log10(abs));
  if (exp >= 123 || abs >= Number.MAX_VALUE / 10) {
    return `${sign}${abs.toExponential(2).replace(/e\+/, "e")}`;
  }

  let best = NAQ_SUFFIXES[0]!;
  for (const u of NAQ_SUFFIXES) {
    if (exp >= u.exp) best = u;
    else break;
  }

  const x = abs / 10 ** best.exp;
  if (x >= 1000) {
    return `${sign}${abs.toExponential(2).replace(/e\+/, "e")}`;
  }
  const digits = x >= 100 ? 0 : x >= 10 ? 1 : 2;
  const body = x
    .toFixed(digits)
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.0+$/, "");
  return `${sign}${body}${best.suffix}`;
}

export const TECH_BRANCH_META: Record<
  TechBranch,
  { label: string; blurb: string }
> = {
  general: {
    label: "General Systems",
    blurb: "Broad combat & covert multiplier",
  },
  mining: {
    label: "Mining Protocols",
    blurb: "More Naq from UU, miners, and military",
  },
  offence: {
    label: "Siege Doctrine",
    blurb: "Offence units hit harder",
  },
  defence: {
    label: "Fortification",
    blurb: "Defence units hold stronger",
  },
  covert: {
    label: "Shadow Ops",
    blurb: "Spies and counter-intel improve",
  },
  equipment: {
    label: "Armory Science",
    blurb: "Weapons deal more; unlocks elite gear",
  },
};
