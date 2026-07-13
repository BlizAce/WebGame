import type { GameSave, RaceId, Realm } from "@/lib/db/schema";
import {
  DEFAULT_SETTINGS,
  DEFAULT_TECH,
  EMPTY_MOTHERSHIP,
  SCHEMA_VERSION,
} from "@/lib/db/schema";
import { starterWeapons } from "@/lib/game/races";
import { mothershipStats, uid } from "@/lib/game/economy";
import { createGalaxyPlanets } from "@/lib/game/planets";

export const TARGET_AI_COUNT = 1_000;
/** How many living AIs a brand-new game starts with (grows toward TARGET via pulses). */
export const AI_STARTING_COUNT = 1_000;
/** Max new living AIs spawned per ensureAiPopulation call (migrate / pulse). */
export const AI_POPULATION_BATCH = 400;

const AI_RACES: RaceId[] = ["asgard", "goauld", "replicator", "tauri"];

const NAME_PREFIX = [
  "Void",
  "Gate",
  "Naq",
  "Silent",
  "Orbital",
  "Ashen",
  "Chrome",
  "Blue",
  "Temple",
  "Drift",
  "Pulse",
  "Iron",
  "Crimson",
  "Hollow",
  "Solar",
  "Night",
  "Quantum",
  "Frost",
  "Ember",
  "Storm",
  "Obsidian",
  "Silver",
  "Jade",
  "Rift",
  "Echo",
  "Nova",
  "Shard",
  "Warden",
  "Phantom",
  "Aether",
];

const NAME_SUFFIX = [
  "Herald",
  "Warden",
  "Baron",
  "Lattice",
  "Crow",
  "Fleet",
  "Swarm",
  "Horizon",
  "Shadow",
  "Admiral",
  "Cartel",
  "Relic",
  "Blade",
  "Spire",
  "Chorus",
  "Forge",
  "Thrall",
  "Sentinel",
  "Corsair",
  "Oracle",
  "Vanguard",
  "Syndicate",
  "Dominion",
  "Archive",
  "Revenant",
  "Colossus",
  "Mirage",
  "Bastion",
  "Spectre",
  "Dynasty",
];

function aiName(index: number): string {
  const a = NAME_PREFIX[index % NAME_PREFIX.length]!;
  const b = NAME_SUFFIX[Math.floor(index / NAME_PREFIX.length) % NAME_SUFFIX.length]!;
  const serial = Math.floor(index / (NAME_PREFIX.length * NAME_SUFFIX.length));
  const base = `${a} ${b}`.replace("  ", " ");
  return serial > 0 ? `${base} ${serial + 1}` : base;
}

/** Next unused AI display name (counts dead husks so replacements stay unique). */
export function nextAiName(save: GameSave): string {
  const used = new Set(save.realms.map((r) => r.name));
  let index = save.realms.filter((r) => !r.isPlayer).length;
  for (let guard = 0; guard < 10_000; guard += 1) {
    const name = aiName(index);
    if (!used.has(name)) return name;
    index += 1;
  }
  return `Echo ${Date.now().toString(36)}`;
}

/**
 * Rename duplicate living AI names (e.g. many "Echo-1000" from a spawn bug).
 * Dead husks keep their † names.
 */
export function dedupeAiNames(save: GameSave): number {
  const seen = new Set<string>();
  let fixed = 0;
  for (const realm of save.realms) {
    if (realm.isPlayer || realm.dead) {
      seen.add(realm.name);
      continue;
    }
    if (!seen.has(realm.name)) {
      seen.add(realm.name);
      continue;
    }
    const next = nextAiName(save);
    // nextAiName reads current names; reserve immediately
    realm.name = next;
    seen.add(next);
    fixed += 1;
  }
  return fixed;
}

/** Power curve: many weak, some mid, few strong apex rivals. */
export function aiPowerScale(index: number, total = TARGET_AI_COUNT): number {
  const t = index / Math.max(1, total - 1);
  // 0.45 … ~3.2 with a long tail of mid-tiers
  if (t < 0.55) return 0.45 + t * 0.9;
  if (t < 0.85) return 0.95 + (t - 0.55) * 2.2;
  if (t < 0.97) return 1.6 + (t - 0.85) * 6;
  return 2.4 + (t - 0.97) * 25;
}

export function createRealm(
  name: string,
  race: RaceId,
  isPlayer: boolean,
  powerScale = 1,
): Realm {
  const baseUu = Math.floor(55 * powerScale);
  const baseMiners = Math.floor(6 * powerScale);
  const baseOff = Math.floor(10 * powerScale);
  const baseDef = Math.floor(12 * powerScale);
  const techGeneral = Math.max(1, Math.floor(powerScale * 0.6));
  const msTier = isPlayer ? 0 : Math.max(0, Math.min(4, Math.floor(powerScale) - 1));

  const weapons = starterWeapons(race)
    .map((w) => {
      let qty = 0;
      if (w.techReq <= 1 && w.power <= 10) {
        qty = Math.floor((isPlayer ? 4 : 5) * powerScale);
      } else if (w.techReq <= 1 && w.power <= 40) {
        qty = Math.floor((isPlayer ? 1 : 2) * powerScale);
      } else if (!isPlayer && w.techReq <= 3 && powerScale >= 1.4) {
        qty = Math.max(1, Math.floor(powerScale - 0.5));
      }
      return { ...w, quantity: qty };
    })
    // AI: keep buyable tier-1 catalog + owned gear only (save size)
    .filter((w) => isPlayer || w.quantity > 0 || w.techReq <= 1);

  return {
    id: uid(isPlayer ? "player" : "ai"),
    name,
    race,
    isPlayer,
    naquadah: Math.floor(1400 * powerScale),
    bankNaquadah: Math.floor(350 * powerScale),
    bankLevel: 1,
    attackTurns: 18,
    restedAttackTurns: 6,
    covertCapacity: 6,
    unitProductionLevel: Math.max(1, Math.floor(1 + powerScale)),
    spyLevel: Math.max(1, Math.floor(powerScale * 0.8)),
    antiSpyLevel: Math.max(1, Math.floor(powerScale * 0.8)),
    techLevel: techGeneral,
    tech: {
      ...DEFAULT_TECH,
      general: techGeneral,
      mining: Math.max(1, Math.floor(powerScale * 0.5)),
      offence: Math.max(1, Math.floor(powerScale * 0.5)),
      defence: Math.max(1, Math.floor(powerScale * 0.5)),
      equipment: Math.max(1, Math.floor(powerScale * 0.4)),
    },
    units: {
      untrained: baseUu,
      miners: baseMiners,
      offence: baseOff,
      defence: baseDef,
      covert: Math.floor(5 * powerScale),
      antiCovert: Math.floor(5 * powerScale),
    },
    weapons,
    mothership: msTier > 0 ? mothershipStats(msTier) : { ...EMPTY_MOTHERSHIP },
    defenceAlert: 0,
    attackFatigue: 0,
    vacation: false,
    gloryReputation: isPlayer ? 0 : Math.floor(15 * powerScale + Math.random() * 10),
    ascensionLevel: 0,
    ascensionPoints: 0,
    factionId: isPlayer ? "unaligned" : undefined,
  };
}

export function createAiRivals(count = AI_STARTING_COUNT): Realm[] {
  const rivals: Realm[] = [];
  for (let i = 0; i < count; i++) {
    const race = AI_RACES[i % AI_RACES.length]!;
    const scale = aiPowerScale(i, TARGET_AI_COUNT);
    rivals.push(createRealm(aiName(i), race, false, scale));
  }
  return rivals;
}

/**
 * Pad living AI count toward TARGET_AI_COUNT, at most `maxBatch` per call
 * so migrate / pulses stay responsive at 40k scale.
 */
export function ensureAiPopulation(
  save: GameSave,
  target = TARGET_AI_COUNT,
  maxBatch = AI_POPULATION_BATCH,
): number {
  let living = 0;
  for (const r of save.realms) {
    if (!r.isPlayer && !r.dead) living += 1;
  }
  const need = Math.min(Math.max(0, target - living), Math.max(0, maxBatch));
  if (need <= 0) return 0;

  const used = new Set<string>();
  let nonPlayer = 0;
  for (const r of save.realms) {
    used.add(r.name);
    if (!r.isPlayer) nonPlayer += 1;
  }
  let index = nonPlayer;
  for (let i = 0; i < need; i++) {
    let name = aiName(index);
    while (used.has(name)) {
      index += 1;
      name = aiName(index);
    }
    used.add(name);
    index += 1;
    const race = AI_RACES[(living + i) % AI_RACES.length]!;
    const scale = aiPowerScale(living + i, target);
    save.realms.push(createRealm(name, race, false, scale));
  }
  return need;
}

export function createNewGame(playerName: string, race: RaceId): GameSave {
  const player = createRealm(playerName, race, true, 1);
  const lightAtk = player.weapons.find((w) => w.slot === "attack" && w.power <= 10);
  const lightDef = player.weapons.find((w) => w.slot === "defence" && w.power <= 10);
  if (lightAtk) lightAtk.quantity = Math.max(lightAtk.quantity, 3);
  if (lightDef) lightDef.quantity = Math.max(lightDef.quantity, 2);

  const rivals = createAiRivals(AI_STARTING_COUNT);

  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    lastTickAt: now,
    lastAiPulseAt: now,
    playerId: player.id,
    realms: [player, ...rivals],
    planets: createGalaxyPlanets(),
    alliances: [],
    contracts: [],
    news: [],
    wars: [],
    fleetClusters: [],
    forum: { posts: [] },
    mail: { threads: [] },
    market: {
      inventory: { untrained: 800, attackTurns: 40 },
      recentSells: { untrained: 0, attackTurns: 0 },
      lastDecayAt: now,
      trades: [],
      priceHistory: [],
    },
    logs: { attacks: [], intelligence: [] },
    settings: { ...DEFAULT_SETTINGS },
  };
}
