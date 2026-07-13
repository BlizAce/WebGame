import type {
  Mothership,
  MothershipPartId,
  MothershipParts,
  Realm,
} from "@/lib/db/schema";
import { DEFAULT_MOTHERSHIP_PARTS } from "@/lib/db/schema";

/** Hull class tiers (commission + upgrades). */
export const MOTHERSHIP_MAX_TIER = 12;

/** Systems upgraded by level (not capacity/fittings). */
export const MOTHERSHIP_MODULE_IDS = [
  "hull",
  "engines",
  "sensors",
  "hangar",
  "reactor",
  "armor",
  "command",
] as const satisfies readonly MothershipPartId[];

export type MothershipModuleId = (typeof MOTHERSHIP_MODULE_IDS)[number];

export type MothershipArmamentKind = "weapons" | "shields";

export const MOTHERSHIP_PART_META: Record<
  MothershipPartId,
  { label: string; blurb: string; max: number }
> = {
  hull: {
    label: "Hull Lattice",
    blurb: "Structural plating — raises max hull integrity",
    max: 40,
  },
  weapons: {
    label: "Weapon Banks",
    blurb: "Fitted primary guns — fill weapon capacity",
    max: Number.POSITIVE_INFINITY,
  },
  shields: {
    label: "Shield Banks",
    blurb: "Fitted deflectors — fill shield capacity",
    max: Number.POSITIVE_INFINITY,
  },
  weaponCapacity: {
    label: "Weapon Capacity",
    blurb: "Expand bay slots for more weapon banks (Gate Wars–style)",
    max: Number.POSITIVE_INFINITY,
  },
  shieldCapacity: {
    label: "Shield Capacity",
    blurb: "Expand bay slots for more shield banks",
    max: Number.POSITIVE_INFINITY,
  },
  engines: {
    label: "Drive Core",
    blurb: "Gate transit engines — planet conquest edge",
    max: 40,
  },
  sensors: {
    label: "Sensor Suite",
    blurb: "Targeting arrays — sensor power for fleet ops",
    max: 40,
  },
  hangar: {
    label: "Hanger Bays",
    blurb: "Fighter wings — flat fleet power and support",
    max: 40,
  },
  reactor: {
    label: "Naquadah Reactor",
    blurb: "Power core — multiplies fitted weapon & shield output",
    max: 40,
  },
  armor: {
    label: "Ablative Armor",
    blurb: "Layered plating — hull buffer and toughness",
    max: 40,
  },
  command: {
    label: "Command Bridge",
    blurb: "Fleet coordination — strike & defence support",
    max: 40,
  },
};

export const MOTHERSHIP_PART_IDS = Object.keys(
  MOTHERSHIP_PART_META,
) as MothershipPartId[];

/** Constant-ish unit cost to install one weapon bank (classic GW). */
export const MOTHERSHIP_WEAPON_UNIT_COST = 900;
/** Constant-ish unit cost to install one shield bank. */
export const MOTHERSHIP_SHIELD_UNIT_COST = 850;

export function ensureMothershipParts(ms: Mothership): MothershipParts {
  if (!ms.parts) ms.parts = { ...DEFAULT_MOTHERSHIP_PARTS };
  for (const id of MOTHERSHIP_PART_IDS) {
    if (ms.parts[id] == null) ms.parts[id] = 0;
  }
  // Legacy saves: part levels without capacity → capacity matches fitted.
  if (ms.parts.weaponCapacity < ms.parts.weapons) {
    ms.parts.weaponCapacity = ms.parts.weapons;
  }
  if (ms.parts.shieldCapacity < ms.parts.shields) {
    ms.parts.shieldCapacity = ms.parts.shields;
  }
  return ms.parts;
}

export function mothershipPartUpgradeCost(
  part: MothershipPartId,
  level: number,
): number {
  const base: Partial<Record<MothershipPartId, number>> = {
    hull: 900,
    engines: 1050,
    sensors: 950,
    hangar: 1000,
    reactor: 1400,
    armor: 1100,
    command: 1200,
  };
  const growth: Partial<Record<MothershipPartId, number>> = {
    hull: 1.38,
    engines: 1.4,
    sensors: 1.38,
    hangar: 1.39,
    reactor: 1.42,
    armor: 1.4,
    command: 1.41,
  };
  const b = base[part];
  const g = growth[part];
  if (b == null || g == null) {
    throw new Error(`${part} is not a level-upgraded module`);
  }
  return Math.floor(b * Math.pow(g, Math.max(0, level)));
}

/** Escalating cost to expand weapon/shield bay capacity (Gate Wars). */
export function mothershipCapacityUpgradeCost(
  kind: MothershipArmamentKind,
  currentCapacity: number,
): number {
  const base = kind === "weapons" ? 4200 : 3800;
  return Math.floor(base * Math.pow(1.14, Math.max(0, currentCapacity)));
}

export function mothershipArmamentUnitCost(kind: MothershipArmamentKind): number {
  return kind === "weapons"
    ? MOTHERSHIP_WEAPON_UNIT_COST
    : MOTHERSHIP_SHIELD_UNIT_COST;
}

export function mothershipUpgradeCost(tier: number): number {
  if (tier <= 0) return 2500;
  return Math.floor(2500 * Math.pow(2.05, tier));
}

const TIER_NAMES = [
  "Scout Carrier",
  "Gate Cruiser",
  "Battle Barge",
  "Dreadnought",
  "Worldship",
  "Ascendant Ark",
  "Horizon Leviathan",
  "System Lord Vessel",
  "Ancient Warship",
  "Destiny-Class",
  "City-Ship",
  "Eternal Flagship",
];

function reactorMult(reactor: number): number {
  return 1 + reactor * 0.05;
}

/** Recompute derived power / hull from tier + parts (preserves current hull %). */
export function recomputeMothership(ms: Mothership): Mothership {
  const parts = ensureMothershipParts(ms);
  if (ms.tier <= 0) {
    return {
      tier: 0,
      name: "None",
      power: 0,
      hull: 0,
      maxHull: 0,
      parts,
    };
  }

  const tier = ms.tier;
  const basePower = Math.floor(80 * Math.pow(1.9, tier - 1));
  const baseHull = Math.floor(200 * Math.pow(1.75, tier - 1));
  const rx = reactorMult(parts.reactor);

  // Fitted armament scales with tier so late ships stay relevant (GW-style volume).
  const weaponUnit = 22 + tier * 10;
  const shieldUnit = 18 + tier * 8;
  const armamentPower = Math.floor(
    (parts.weapons * weaponUnit + parts.shields * shieldUnit) * rx,
  );

  const modulePower = Math.floor(
    (parts.hangar * (20 + tier * 4) +
      parts.engines * (14 + tier * 3) +
      parts.sensors * (10 + tier * 2) +
      parts.command * (16 + tier * 5) +
      parts.hull * (6 + tier) +
      parts.armor * (8 + tier * 2)) *
      rx,
  );

  const maxHull = Math.floor(
    baseHull *
      (1 +
        parts.hull * 0.1 +
        parts.armor * 0.12 +
        parts.shields * 0.004 +
        parts.shieldCapacity * 0.002),
  );
  const power = Math.floor(basePower + armamentPower + modulePower);

  const ratio =
    ms.maxHull > 0 ? Math.min(1, Math.max(0, ms.hull / ms.maxHull)) : 1;

  return {
    tier,
    name: TIER_NAMES[Math.min(tier - 1, TIER_NAMES.length - 1)]!,
    power,
    maxHull,
    hull: Math.max(1, Math.floor(maxHull * ratio)),
    parts,
  };
}

export function mothershipStats(
  tier: number,
  parts?: Partial<MothershipParts>,
): Mothership {
  const merged: MothershipParts = {
    ...DEFAULT_MOTHERSHIP_PARTS,
    ...parts,
  };
  return recomputeMothership({
    tier,
    name: "",
    power: 0,
    hull: 1,
    maxHull: 1,
    parts: merged,
  });
}

export function upgradeMothershipPart(
  realm: Realm,
  part: MothershipPartId,
): { cost: number; level: number } {
  if (
    part === "weapons" ||
    part === "shields" ||
    part === "weaponCapacity" ||
    part === "shieldCapacity"
  ) {
    throw new Error("Use capacity expand / armament install for weapons & shields");
  }
  const ms = realm.mothership;
  if (!ms || ms.tier < 1) throw new Error("Commission a mothership first");
  const parts = ensureMothershipParts(ms);
  const meta = MOTHERSHIP_PART_META[part];
  if (parts[part] >= meta.max) throw new Error(`${meta.label} is maxed`);
  const cost = mothershipPartUpgradeCost(part, parts[part]);
  if (realm.naquadah < cost) {
    throw new Error(`Need ${cost.toLocaleString()} Naq`);
  }
  realm.naquadah -= cost;
  parts[part] += 1;
  realm.mothership = recomputeMothership(ms);
  return { cost, level: parts[part] };
}

export function expandMothershipCapacity(
  realm: Realm,
  kind: MothershipArmamentKind,
): { cost: number; capacity: number } {
  const ms = realm.mothership;
  if (!ms || ms.tier < 1) throw new Error("Commission a mothership first");
  const parts = ensureMothershipParts(ms);
  const key = kind === "weapons" ? "weaponCapacity" : "shieldCapacity";
  const cost = mothershipCapacityUpgradeCost(kind, parts[key]);
  if (realm.naquadah < cost) {
    throw new Error(`Need ${cost.toLocaleString()} Naq`);
  }
  realm.naquadah -= cost;
  parts[key] += 1;
  realm.mothership = recomputeMothership(ms);
  return { cost, capacity: parts[key] };
}

export function installMothershipArmament(
  realm: Realm,
  kind: MothershipArmamentKind,
  qty = 1,
): { cost: number; fitted: number } {
  const ms = realm.mothership;
  if (!ms || ms.tier < 1) throw new Error("Commission a mothership first");
  const n = Math.max(1, Math.floor(qty));
  const parts = ensureMothershipParts(ms);
  const fittedKey = kind === "weapons" ? "weapons" : "shields";
  const capKey = kind === "weapons" ? "weaponCapacity" : "shieldCapacity";
  const free = parts[capKey] - parts[fittedKey];
  if (free <= 0) {
    throw new Error(
      kind === "weapons"
        ? "No free weapon capacity — expand bays first"
        : "No free shield capacity — expand bays first",
    );
  }
  const install = Math.min(n, free);
  const unit = mothershipArmamentUnitCost(kind);
  const cost = unit * install;
  if (realm.naquadah < cost) {
    throw new Error(`Need ${cost.toLocaleString()} Naq`);
  }
  realm.naquadah -= cost;
  parts[fittedKey] += install;
  realm.mothership = recomputeMothership(ms);
  return { cost, fitted: parts[fittedKey] };
}

/** Defence contribution from shields beyond base power. */
export function mothershipDefenceBonus(realm: Realm): number {
  const ms = realm.mothership;
  if (!ms || ms.tier < 1) return 0;
  const parts = ensureMothershipParts(ms);
  const rx = reactorMult(parts.reactor);
  const shieldBoost = Math.floor(
    parts.shields * (28 + ms.tier * 12) * rx + parts.command * (12 + ms.tier * 3),
  );
  return Math.floor(ms.power * 0.9 + shieldBoost);
}

export function mothershipConquerBonus(realm: Realm): number {
  const ms = realm.mothership;
  if (!ms || ms.tier < 1) return 0;
  const parts = ensureMothershipParts(ms);
  const rx = reactorMult(parts.reactor);
  return Math.floor(
    (parts.engines * (40 + ms.tier * 8) +
      parts.sensors * (18 + ms.tier * 4) +
      parts.hangar * (24 + ms.tier * 5) +
      parts.command * (20 + ms.tier * 4)) *
      rx,
  );
}

/** Combat wear: hull damage plus some fitted banks destroyed (GW-style). */
export function wearMothershipArmament(realm: Realm, hullDamage: number): void {
  const ms = realm.mothership;
  if (!ms || ms.tier <= 0) return;
  const parts = ensureMothershipParts(ms);
  ms.hull = Math.max(0, ms.hull - hullDamage);
  const scrap = Math.floor(hullDamage / 18);
  if (scrap <= 0) return;
  const loseWeapons = Math.min(parts.weapons, Math.ceil(scrap * 0.55));
  const loseShields = Math.min(parts.shields, Math.ceil(scrap * 0.75));
  parts.weapons -= loseWeapons;
  parts.shields -= loseShields;
  realm.mothership = recomputeMothership(ms);
}
