import type { GameSave, Realm } from "@/lib/db/schema";
import { resolveAttack, resolveEradication, resolvePlanetConquer } from "@/lib/game/combat";
import {
  resolveAssassinate,
  resolveSabotage,
  resolveSpy,
} from "@/lib/game/covert";
import {
  antiSpyUpgradeCost,
  bankCapacity,
  bankUpgradeCost,
  clamp,
  defenceAction,
  depositFeeRate,
  ensureTech,
  mothershipStats,
  mothershipUpgradeCost,
  mothershipPartUpgradeCost,
  mothershipCapacityUpgradeCost,
  mothershipArmamentUnitCost,
  ensureMothershipParts,
  recomputeMothership,
  expandMothershipCapacity,
  installMothershipArmament,
  MOTHERSHIP_MAX_TIER,
  spyUpgradeCost,
  strikeAction,
  techBranchCost,
  type TechBranch,
  trainCost,
  upUpgradeCost,
  MAX_ATTACK_TURNS,
} from "@/lib/game/economy";
import { mothershipConquerBonus } from "@/lib/game/mothership";
import { isBelowAttackRankRange } from "@/lib/game/rankings";
import type { MothershipModuleId } from "@/lib/game/mothership";
import { starterWeapons } from "@/lib/game/races";
import {
  ascensionRequirements,
  performAscension,
  spendAscensionPoints,
} from "@/lib/game/ascension";
import {
  createDonationRequest,
  fulfillDonationRequest,
  openContractsForDonor,
  pruneContracts,
  MIN_CONTRACT_AMOUNT,
} from "@/lib/game/contracts";
import {
  ALLIANCE_CREATE_COST,
  allianceCombatBonus,
  bestGuildToJoin,
  createAlliance,
  ensureAlliances,
  ensureGuildTech,
  getAlliance,
  guildTechUpgradeCost,
  joinAlliance,
  pickFactionForRealm,
  pruneEmptyGuilds,
  randomGuildName,
  sameAlliance,
  sameFaction,
  upgradeGuildTech,
  depositGuildFund,
  ensureGuildFund,
  type GuildTechBranch,
} from "@/lib/game/guilds";
import { maybeUniverseBlip } from "@/lib/game/news";
import {
  areGuildsAtWar,
  canAttemptEradication,
  eradicationPowerRatio,
  ERADICATION_TURN_COST,
  tryAiDeclareWar,
  tryAiEndWar,
  warsForGuild,
  warEnemyMembers,
} from "@/lib/game/wars";
import {
  BASE_PRICE,
  executeMarketTrade,
  marketBoard,
  quoteTrade,
  quoteUnitPrice,
  decayMarketPressure,
} from "@/lib/game/market";
import type { MarketCommodity } from "@/lib/db/schema";
import { ensureMind, executeAiPlan, pushAction } from "@/lib/game/mind";
import {
  FLEET_CLUSTER_MAX,
  clusterLivingMembers,
  effectiveDefencePotential,
  getClusterForGuild,
  getClusterForRealm,
  joinFleetCluster,
  leaveFleetCluster,
  startFleetCluster,
} from "@/lib/game/fleetClusters";
import {
  ensureAiPopulation,
  TARGET_AI_COUNT,
  AI_POPULATION_BATCH,
} from "@/lib/db/seed";

export const DEFAULT_AI_PULSES_PER_HOUR = 8;
const MAX_AI_CATCHUP = 12;
/** Default / clamp bounds for settings.aiActorsPerPulse */
export const AI_ACTORS_PER_PULSE_MIN = 1;
export const AI_ACTORS_PER_PULSE_MAX = 5000;
export const DEFAULT_AI_ACTORS_PER_PULSE = 25;
const TARGET_SAMPLE = 64;

type AiArchetype = "farmer" | "aggressor" | "turtle" | "covert";

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function chance(p: number) {
  return Math.random() < p;
}

function randInt(min: number, max: number) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function clampAiActorsPerPulse(n: number) {
  return Math.max(
    AI_ACTORS_PER_PULSE_MIN,
    Math.min(AI_ACTORS_PER_PULSE_MAX, Math.floor(n) || DEFAULT_AI_ACTORS_PER_PULSE),
  );
}

/** Next `count` living AIs from the round-robin cursor (wraps). O(batch), not O(all). */
function takeNextLivingAis(
  save: GameSave,
  count: number,
): Realm[] {
  const realms = save.realms;
  const n = realms.length;
  if (!n || count <= 0) return [];

  let cursor = save.aiActorCursor ?? 0;
  if (cursor < 0 || cursor >= n) cursor = 0;

  const actors: Realm[] = [];
  let scanned = 0;
  while (actors.length < count && scanned < n) {
    const r = realms[cursor]!;
    cursor += 1;
    if (cursor >= n) cursor = 0;
    scanned += 1;
    if (r.isPlayer || r.vacation || r.dead) continue;
    actors.push(r);
  }
  save.aiActorCursor = cursor;
  return actors;
}

function hashArchetype(id: string): AiArchetype {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const types: AiArchetype[] = ["farmer", "aggressor", "turtle", "covert"];
  return types[h % types.length]!;
}

function social(ai: Realm, save: GameSave) {
  return allianceCombatBonus(ai, save);
}

function totalArmed(ai: Realm, slot: "attack" | "defence") {
  return ai.weapons
    .filter((w) => w.slot === slot)
    .reduce((s, w) => s + w.quantity, 0);
}

function isFriendly(save: GameSave, a: Realm, b: Realm): boolean {
  if (sameAlliance(a, b)) return true;
  // Wartime enemies are fair game even if same faction
  if (areGuildsAtWar(save, a, b)) return false;
  return sameFaction(a, b);
}

function sampleHostileTargets(
  save: GameSave,
  self: Realm,
  n = TARGET_SAMPLE,
): Realm[] {
  const realms = save.realms;
  if (realms.length <= 1) return [];

  const out: Realm[] = [];
  const seen = new Set<string>();
  // Random probes beat O(population) filters at 40k scale
  const attempts = Math.min(realms.length * 2, Math.max(n * 40, 800));
  for (let t = 0; t < attempts && out.length < n; t++) {
    const r = realms[Math.floor(Math.random() * realms.length)]!;
    if (seen.has(r.id)) continue;
    if (r.id === self.id || r.vacation || r.dead) continue;
    if (isFriendly(save, self, r)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

function bestAttackTarget(
  ai: Realm,
  save: GameSave,
): { target: Realm; kind: "attack" | "raid" } | null {
  const planets = save.planets ?? [];
  const myStrike = strikeAction(ai, planets, social(ai, save));
  if (myStrike < 30 || ai.attackTurns < 1) return null;

  const atWar = !!ai.allianceId && warsForGuild(save, ai.allianceId).length > 0;

  const candidates = sampleHostileTargets(save, ai)
    .filter((t) => !isBelowAttackRankRange(save, ai.id, t.id))
    .map((t) => {
      const def = effectiveDefencePotential(t, planets, save);
      const ratio = myStrike / Math.max(1, def);
      const lootScore = t.naquadah * 0.75 + t.units.untrained * 8;
      let score =
        ratio >= 1.2
          ? lootScore * (1 + Math.min(3, ratio - 1))
          : ratio >= 1.05
            ? lootScore * 0.5
            : ratio >= 0.95
              ? lootScore * 0.15
              : -1;
      if (score > 0 && areGuildsAtWar(save, ai, t)) {
        // Wartime enemies are the priority theatre
        score *= 4.5;
        // Prefer gutted foes for annihilation pressure
        if (t.units.offence + t.units.defence <= 12) score *= 1.6;
      } else if (score > 0 && atWar) {
        // Soft-deprioritize peacetime targets while a guild war is active
        score *= 0.35;
      }
      return { t, score, ratio };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) return null;
  const chosen = pick(candidates.slice(0, Math.min(6, candidates.length)));
  const kind: "attack" | "raid" =
    areGuildsAtWar(save, ai, chosen.t) &&
    chosen.t.units.offence + chosen.t.units.defence <= 10
      ? "attack" // finish wartime foes with attacks (annihilation path)
      : chosen.t.naquadah < 500 && chosen.t.units.untrained > 100
        ? "raid"
        : "attack";
  return { target: chosen.t, kind };
}

/** Dedicated wartime campaign — burn turns on enemy guild members. */
function tryWarCampaign(save: GameSave, ai: Realm, arch: AiArchetype): boolean {
  if (!ai.allianceId || ai.attackTurns < 2) return false;
  const wars = warsForGuild(save, ai.allianceId);
  if (!wars.length) return false;

  const planets = save.planets ?? [];
  const myStrike = strikeAction(ai, planets, social(ai, save));
  if (myStrike < 25) return false;

  // Buy turns if low and market is cheap
  if (ai.attackTurns < 8 && chance(0.65)) {
    tryMarketAdvantage(save, ai, arch);
  }

  const enemies: Realm[] = [];
  for (const w of wars) {
    enemies.push(...warEnemyMembers(save, w, ai.allianceId));
  }
  if (!enemies.length) return false;

  const ranked = enemies
    .filter((t) => !isBelowAttackRankRange(save, ai.id, t.id))
    .map((t) => {
      const def = effectiveDefencePotential(t, planets, save);
      const ratio = myStrike / Math.max(1, def);
      const soft = t.units.offence + t.units.defence;
      let score = ratio >= 0.9 ? ratio * 100 + t.naquadah * 0.01 : -1;
      if (soft <= 8) score += 80; // annihilation candidates
      if (ratio >= 2) score += 40;
      return { t, score, ratio };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) {
    // Still at war but can't beat anyone — train / buy weapons / buy turns
    if (ai.units.untrained > 5) trySmartTrain(ai, arch === "turtle" ? "turtle" : "aggressor", false);
    trySmartBuyWeapon(ai);
    tryAggressiveUpgrades(ai, "aggressor", 4);
    return false;
  }

  const waves = Math.min(
    arch === "aggressor" ? 5 : 4,
    Math.max(1, Math.floor(ai.attackTurns / 4)),
  );
  let hit = false;
  for (let i = 0; i < waves && ai.attackTurns >= 2; i++) {
    const pickT = ranked[Math.min(i, ranked.length - 1)]!;
    // Re-check still alive
    if (pickT.t.dead) continue;

    // Kill move when massively overpowered
    if (
      canAttemptEradication(ai, pickT.t, planets) &&
      ai.attackTurns >= ERADICATION_TURN_COST &&
      (pickT.ratio >= 20 || chance(0.55))
    ) {
      try {
        const { log } = resolveEradication(ai, pickT.t, planets, save);
        save.logs.attacks.unshift(log);
        hit = true;
        if (log.eradicated) continue;
      } catch {
        /* fall through to normal attack */
      }
    }

    const turns = Math.min(
      ai.attackTurns,
      pickT.ratio >= 2 ? randInt(8, 15) : randInt(5, 12),
    );
    try {
      const { log } = resolveAttack(
        ai,
        pickT.t,
        turns,
        "attack",
        planets,
        save,
      );
      save.logs.attacks.unshift(log);
      hit = true;
    } catch {
      break;
    }
  }

  // Covert harassment on wartime foes when turns are low
  if (!hit && ai.covertCapacity >= 1 && chance(0.55)) {
    const soft = ranked.find((x) => x.t.units.covert < 5) ?? ranked[0];
    if (soft) {
      try {
        if (chance(0.5)) {
          const { log } = resolveSabotage(ai, soft.t, Math.min(4, ai.units.covert || 1));
          save.logs.intelligence.unshift(log);
        } else {
          const { log } = resolveSpy(ai, soft.t, Math.min(3, ai.units.covert || 1));
          save.logs.intelligence.unshift(log);
        }
        save.logs.intelligence = save.logs.intelligence.slice(0, 200);
        hit = true;
      } catch {
        /* ignore */
      }
    }
  }

  return hit;
}

function ensureAiWeaponCatalog(ai: Realm) {
  const catalog = starterWeapons(ai.race);
  for (const template of catalog) {
    if (!ai.weapons.find((w) => w.id === template.id)) {
      ai.weapons.push({ ...template, quantity: 0 });
    }
  }
}

function trySmartTrain(ai: Realm, arch: AiArchetype, prepAscend: boolean) {
  if (ai.units.untrained < 2 || ai.naquadah < trainCost("miners")) return false;

  const atkArmed = totalArmed(ai, "attack");
  const defArmed = totalArmed(ai, "defence");
  const needAtk = Math.max(0, atkArmed - ai.units.offence);
  const needDef = Math.max(0, defArmed - ai.units.defence);
  const req = ascensionRequirements(ai);

  let kind: keyof Realm["units"] = "miners";
  if (prepAscend && !req.trainedOk) {
    kind = chance(0.5) ? "offence" : "defence";
  } else if (needAtk > 3) kind = "offence";
  else if (needDef > 3) kind = "defence";
  else if (arch === "farmer") kind = chance(0.7) ? "miners" : "defence";
  else if (arch === "turtle") kind = chance(0.65) ? "defence" : "miners";
  else if (arch === "aggressor") kind = chance(0.55) ? "offence" : "miners";
  else kind = chance(0.45) ? "covert" : chance(0.5) ? "antiCovert" : "miners";

  const maxAfford = Math.floor(ai.naquadah / trainCost(kind));
  // Spend hard — convert most available UU when flush
  const qty = Math.min(
    ai.units.untrained,
    maxAfford,
    prepAscend ? randInt(15, 60) : randInt(8, 48),
  );
  if (qty < 1) return false;
  ai.units.untrained -= qty;
  ai.units[kind] += qty;
  ai.naquadah -= trainCost(kind) * qty;
  return true;
}

function trySmartBuyWeapon(ai: Realm) {
  ensureAiWeaponCatalog(ai);
  const tech = ensureTech(ai);
  const needAtk = Math.max(0, ai.units.offence - totalArmed(ai, "attack"));
  const needDef = Math.max(0, ai.units.defence - totalArmed(ai, "defence"));
  // Always try to stock some weapons if flush, even when currently matched
  if (needAtk <= 0 && needDef <= 0 && ai.naquadah < 400 && !chance(0.25)) {
    return false;
  }

  let bought = false;
  for (let pass = 0; pass < 2; pass++) {
    const slot: "attack" | "defence" =
      pass === 0
        ? needAtk >= needDef
          ? "attack"
          : "defence"
        : needAtk >= needDef
          ? "defence"
          : "attack";
    const need = slot === "attack" ? needAtk : needDef;
    if (need <= 0 && pass === 1 && !chance(0.4)) continue;

    const options = ai.weapons
      .filter(
        (w) =>
          w.slot === slot &&
          w.buyCost <= ai.naquadah &&
          tech.equipment >= (w.techReq ?? 1),
      )
      .sort((a, b) => b.power / a.buyCost - a.power / b.buyCost);
    if (!options.length) continue;
    const w = options[0]!;
    const want = Math.max(1, need || 6, 4);
    const qty = Math.min(want, Math.floor(ai.naquadah / w.buyCost), 50);
    if (qty < 1) continue;
    ai.naquadah -= w.buyCost * qty;
    w.quantity += qty;
    bought = true;
  }
  return bought;
}

function tryRepair(ai: Realm) {
  const damaged = ai.weapons
    .filter((w) => w.quantity > 0 && w.durability < w.maxDurability * 0.85)
    .sort(
      (a, b) =>
        a.durability / a.maxDurability - b.durability / b.maxDurability,
    );
  if (!damaged.length) return false;
  let repaired = false;
  for (const w of damaged.slice(0, 3)) {
    const missing = w.maxDurability - w.durability;
    if (missing <= 0) continue;
    const cost = Math.ceil(
      w.buyCost * 0.01 * missing * Math.max(1, w.quantity),
    );
    if (ai.naquadah < cost) continue;
    ai.naquadah -= cost;
    w.durability = w.maxDurability;
    repaired = true;
  }
  return repaired;
}

function trySmartDeposit(ai: Realm, save: GameSave, prepAscend: boolean) {
  // Keep liquid Naq when preparing to ascend or still buying growth
  if (prepAscend) return false;
  if (ai.naquadah < 2500) return false;
  const keep = 800 + ai.units.offence * 3 + ai.unitProductionLevel * 40;
  const amount = Math.floor(ai.naquadah - keep);
  if (amount < 200) return false;
  const cap = bankCapacity(ai, save.planets ?? []);
  const room = Math.max(0, cap - ai.bankNaquadah);
  if (room < 50) {
    const cost = bankUpgradeCost(ai.bankLevel);
    if (ai.naquadah >= cost) {
      ai.naquadah -= cost;
      ai.bankLevel += 1;
      return true;
    }
    return false;
  }
  const depositAmt = Math.min(
    amount,
    Math.ceil(room / Math.max(0.01, 1 - depositFeeRate(ai.race))),
  );
  const f = Math.floor(depositAmt * depositFeeRate(ai.race));
  ai.naquadah -= depositAmt;
  ai.bankNaquadah += depositAmt - f;
  return true;
}

/**
 * Spend as much liquid Naq as useful each pulse — prioritize income (UP,
 * mining, miners via train elsewhere) then combat power.
 */
function tryAggressiveUpgrades(ai: Realm, arch: AiArchetype, maxBuys = 6) {
  const tech = ensureTech(ai);
  let buys = 0;

  while (buys < maxBuys) {
    type Opt = { cost: number; weight: number; apply: () => void };
    const opts: Opt[] = [
      {
        cost: upUpgradeCost(ai.unitProductionLevel),
        weight: arch === "farmer" ? 18 : 14,
        apply: () => {
          ai.unitProductionLevel += 1;
        },
      },
      {
        cost: spyUpgradeCost(ai.spyLevel),
        weight: arch === "covert" ? 8 : 2,
        apply: () => {
          ai.spyLevel += 1;
        },
      },
      {
        cost: antiSpyUpgradeCost(ai.antiSpyLevel),
        weight: arch === "turtle" || arch === "covert" ? 7 : 2,
        apply: () => {
          ai.antiSpyLevel += 1;
        },
      },
      {
        cost: bankUpgradeCost(ai.bankLevel),
        weight: 4,
        apply: () => {
          ai.bankLevel += 1;
        },
      },
    ];

    const branchWeights: Record<TechBranch, number> = {
      general: 5,
      mining: arch === "farmer" ? 16 : 10,
      offence: arch === "aggressor" ? 11 : 4,
      defence: arch === "turtle" ? 11 : 4,
      covert: arch === "covert" ? 11 : 3,
      equipment: 7,
    };
    (Object.keys(branchWeights) as TechBranch[]).forEach((branch) => {
      opts.push({
        cost: techBranchCost(branch, tech[branch]),
        weight: branchWeights[branch],
        apply: () => {
          tech[branch] += 1;
          if (branch === "general") ai.techLevel = tech.general;
        },
      });
    });

    const affordable = opts
      .filter((o) => o.cost > 0 && o.cost <= ai.naquadah)
      .sort((a, b) => b.weight / Math.sqrt(b.cost) - a.weight / Math.sqrt(a.cost));
    if (!affordable.length) break;
    const chosen = chance(0.8) ? affordable[0]! : pick(affordable.slice(0, 4));
    ai.naquadah -= chosen.cost;
    chosen.apply();
    buys += 1;
  }
  return buys > 0;
}

/** Drain liquid Naq into growth until reserve or nothing affordable. */
function spendEverythingUseful(ai: Realm, arch: AiArchetype, save: GameSave) {
  const reserve =
    arch === "farmer" ? 200 : arch === "aggressor" ? 350 : 250;
  let guard = 0;
  while (ai.naquadah > reserve && guard < 12) {
    guard += 1;
    let acted = false;
    if (tryAggressiveUpgrades(ai, arch, 3)) acted = true;
    if (ai.units.untrained > 2 && trySmartTrain(ai, arch, false)) acted = true;
    if (trySmartBuyWeapon(ai)) acted = true;
    if (
      (ai.mothership?.tier ?? 0) < 8 &&
      ai.naquadah > mothershipUpgradeCost(ai.mothership?.tier ?? 0) + reserve
    ) {
      if (tryMothership(ai, arch)) acted = true;
    }
    if (ai.allianceId && ai.naquadah > 3000 && chance(0.25)) {
      if (tryFundGuildTech(save, ai, arch)) acted = true;
    }
    if (!acted) break;
  }
}

/**
 * Open Market — buy cheap / sell expensive relative to fair value.
 * Aggressors buy turns; farmers dump surplus UU for upgrade capital;
 * everyone scoops bargains and liquidates excess when flush.
 */
function tryMarketAdvantage(save: GameSave, ai: Realm, arch: AiArchetype): boolean {
  if (ai.dead || ai.vacation) return false;
  if (!chance(0.72)) return false;

  decayMarketPressure(save);
  const board = marketBoard(save);
  let acted = false;

  const tryBuy = (commodity: MarketCommodity, qty: number) => {
    if (qty < 1) return false;
    const quote = quoteTrade(save, commodity, "buy", qty);
    if (!quote.ok || quote.naqTotal > ai.naquadah) return false;
    const fair =
      board.find((b) => b.commodity === commodity)?.fair ??
      BASE_PRICE[commodity];
    // Scoop when under fair (flooded bargains)
    if (quote.unitPrice > fair * 0.97) return false;
    try {
      executeMarketTrade(save, ai, { commodity, side: "buy", quantity: qty });
      return true;
    } catch {
      return false;
    }
  };

  const trySell = (commodity: MarketCommodity, qty: number) => {
    if (qty < 1) return false;
    const row = board.find((b) => b.commodity === commodity);
    // Never dump into a flooded book — that was zeroing the market
    if (row && row.flood < 0.75) return false;
    const quote = quoteTrade(save, commodity, "sell", qty);
    if (!quote.ok) return false;
    const fair = row?.fair ?? BASE_PRICE[commodity];
    const desperate = ai.naquadah < upUpgradeCost(ai.unitProductionLevel) * 0.6;
    if (!desperate && quote.unitPrice < fair * 0.62) return false;
    try {
      executeMarketTrade(save, ai, { commodity, side: "sell", quantity: qty });
      return true;
    } catch {
      return false;
    }
  };

  const uuRow = board.find((b) => b.commodity === "untrained");
  const turnRow = board.find((b) => b.commodity === "attackTurns");

  // --- Buys: clear floods / scoop bargains ---
  if (uuRow && uuRow.buy < uuRow.fair * 0.95 && ai.naquadah > 400) {
    const budget = Math.floor(
      ai.naquadah * (uuRow.flood < 0.7 ? 0.45 : arch === "farmer" ? 0.35 : 0.22),
    );
    const qty = Math.min(
      uuRow.flood < 0.7 ? 1200 : 400,
      Math.floor(budget / Math.max(1, uuRow.buy)),
    );
    if (qty >= 8 && tryBuy("untrained", qty)) acted = true;
  }

  if (
    turnRow &&
    turnRow.buy < turnRow.fair * 0.96 &&
    ai.attackTurns < (arch === "aggressor" ? 80 : 40) &&
    ai.naquadah > 600
  ) {
    const want =
      arch === "aggressor"
        ? randInt(8, 40)
        : arch === "turtle"
          ? randInt(4, 12)
          : randInt(5, 20);
    const room = Math.max(0, MAX_ATTACK_TURNS - Math.floor(ai.attackTurns));
    const qty = Math.min(
      want,
      room,
      Math.floor(ai.naquadah / Math.max(1, turnRow.buy)),
    );
    if (qty >= 2 && tryBuy("attackTurns", qty)) acted = true;
  }

  // --- Sells: only when book isn't flooded ---
  const upCost = upUpgradeCost(ai.unitProductionLevel);
  const needsCash = ai.naquadah < upCost * 1.1 || ai.naquadah < 500;

  const uuKeep =
    arch === "farmer" ? 40 : arch === "aggressor" ? 12 : arch === "turtle" ? 25 : 18;
  if (
    ai.units.untrained > uuKeep + 15 &&
    (needsCash || chance(0.35)) &&
    (!uuRow || uuRow.flood >= 0.8)
  ) {
    const dump = Math.min(
      350,
      Math.floor((ai.units.untrained - uuKeep) * (needsCash ? 0.7 : 0.4)),
    );
    if (dump >= 10 && trySell("untrained", dump)) acted = true;
  }

  const turnKeep =
    arch === "aggressor" ? 40 : arch === "covert" ? 16 : 12;
  if (
    ai.attackTurns > turnKeep + 10 &&
    (arch !== "aggressor" || needsCash) &&
    chance(0.4) &&
    (!turnRow || turnRow.flood >= 0.8)
  ) {
    const dump = Math.min(
      40,
      Math.floor(ai.attackTurns - turnKeep),
    );
    if (dump >= 2 && trySell("attackTurns", dump)) acted = true;
  }

  // Arbitrage: scarce UU — sell more
  if (
    uuRow &&
    uuRow.flood > 1.15 &&
    quoteUnitPrice(save, "untrained", "sell") > uuRow.fair * 1.12 &&
    ai.units.untrained > 30
  ) {
    const dump = Math.min(120, Math.floor(ai.units.untrained * 0.25));
    if (dump >= 15 && trySell("untrained", dump)) acted = true;
  }

  return acted;
}

function tryDonationContracts(save: GameSave, ai: Realm, arch: AiArchetype) {
  pruneContracts(save);
  if (!ai.factionId || ai.factionId === "unaligned") {
    ai.factionId = pickFactionForRealm(ai);
  }

  // Fulfill ally / public requests when flush
  if (ai.naquadah > 1200) {
    const open = openContractsForDonor(save, ai)
      .filter((c) => c.amount <= ai.naquadah * 0.4)
      .sort((a, b) => {
        const ra = save.realms.find((r) => r.id === a.requesterId);
        const rb = save.realms.find((r) => r.id === b.requesterId);
        const allyA =
          ra && (sameAlliance(ai, ra) || sameFaction(ai, ra)) ? 2 : 0;
        const allyB =
          rb && (sameAlliance(ai, rb) || sameFaction(ai, rb)) ? 2 : 0;
        return allyB - allyA || a.amount - b.amount;
      });
    if (open.length && chance(0.55)) {
      const pickC = open[0]!;
      const requester = save.realms.find((r) => r.id === pickC.requesterId);
      const ally =
        requester &&
        (sameAlliance(ai, requester) || sameFaction(ai, requester));
      if (ally || pickC.scope === "public" || pickC.scope === "faction") {
        try {
          fulfillDonationRequest(save, ai, pickC.id);
          return true;
        } catch {
          /* ignore */
        }
      }
    }
  }

  // Post requests often enough that the board stays active
  const upCost = upUpgradeCost(ai.unitProductionLevel);
  const liquid = ai.naquadah + ai.bankNaquadah * 0.15;
  const wantsAid =
    liquid < upCost * 1.2 ||
    ai.unitProductionLevel < 15 ||
    ensureTech(ai).mining < 8 ||
    ai.naquadah < 800;
  if (!wantsAid && !chance(0.12)) return false;

  // Farmers / cartel lean into asking; others still ask regularly
  const askChance =
    arch === "farmer" ? 0.72 : arch === "turtle" ? 0.45 : 0.55;
  if (!chance(askChance)) return false;

  const amount = Math.min(
    25_000,
    Math.max(
      MIN_CONTRACT_AMOUNT,
      Math.floor(upCost * (0.35 + Math.random() * 0.9)) ||
        randInt(250, 2000),
    ),
  );

  const guild = ai.allianceId ? getAlliance(save, ai.allianceId) : undefined;
  const guildHasMates = !!(guild && guild.memberIds.length >= 2);

  // Prefer scopes the player can actually see: public + faction first
  const attempts: Array<() => void> = [];
  if (chance(0.55) || !guildHasMates) {
    attempts.push(() =>
      createDonationRequest(save, ai, {
        amount: Math.min(amount, 4000),
        scope: "public",
        message: pick([
          "Public aid for UP growth",
          "Need Naq for mining tech",
          "Trade board: growth fund",
          "Requesting development capital",
        ]),
      }),
    );
  }
  if (ai.factionId && ai.factionId !== "unaligned") {
    attempts.push(() =>
      createDonationRequest(save, ai, {
        amount,
        scope: "faction",
        message: "Faction aid for upgrades",
      }),
    );
  }
  if (guildHasMates) {
    attempts.push(() =>
      createDonationRequest(save, ai, {
        amount,
        scope: "guild",
        message: "Guild aid for UP / mining",
      }),
    );
  }

  for (const attempt of attempts) {
    try {
      attempt();
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

function tryMothership(ai: Realm, arch: AiArchetype) {
  const tier = ai.mothership?.tier ?? 0;
  if (tier >= MOTHERSHIP_MAX_TIER) return false;
  const cost = mothershipUpgradeCost(tier);
  if (ai.naquadah < cost) return false;
  if (arch === "farmer" && tier === 0 && ai.unitProductionLevel < 5) return false;
  ai.naquadah -= cost;
  const prev = ai.mothership?.parts;
  ai.mothership = mothershipStats(tier + 1, prev);
  return true;
}

/** Expand capacity, install armament, or upgrade modules (Gate Wars–style). */
function tryMothershipParts(ai: Realm, arch: AiArchetype): boolean {
  const ms = ai.mothership;
  if (!ms || ms.tier < 1) return false;
  const parts = ensureMothershipParts(ms);
  const reserve = 500;

  const freeWeapons = parts.weaponCapacity - parts.weapons;
  const freeShields = parts.shieldCapacity - parts.shields;
  if (freeWeapons > 0 || freeShields > 0) {
    const preferShields =
      arch === "turtle" || (arch !== "aggressor" && chance(0.45));
    if (preferShields && freeShields > 0) {
      const qty = Math.min(freeShields, arch === "turtle" ? 4 : 2);
      const cost = mothershipArmamentUnitCost("shields") * qty;
      if (ai.naquadah >= cost + reserve) {
        installMothershipArmament(ai, "shields", qty);
        return true;
      }
    }
    if (freeWeapons > 0) {
      const qty = Math.min(freeWeapons, arch === "aggressor" ? 4 : 2);
      const cost = mothershipArmamentUnitCost("weapons") * qty;
      if (ai.naquadah >= cost + reserve) {
        installMothershipArmament(ai, "weapons", qty);
        return true;
      }
    }
    if (freeShields > 0) {
      const qty = Math.min(freeShields, 2);
      const cost = mothershipArmamentUnitCost("shields") * qty;
      if (ai.naquadah >= cost + reserve) {
        installMothershipArmament(ai, "shields", qty);
        return true;
      }
    }
  }

  const expandPrefer: Array<"weapons" | "shields"> =
    arch === "turtle"
      ? ["shields", "weapons"]
      : arch === "aggressor"
        ? ["weapons", "shields"]
        : chance(0.5)
          ? ["weapons", "shields"]
          : ["shields", "weapons"];
  for (const kind of expandPrefer) {
    const cap =
      kind === "weapons" ? parts.weaponCapacity : parts.shieldCapacity;
    const cost = mothershipCapacityUpgradeCost(kind, cap);
    if (ai.naquadah < cost + reserve * 2) continue;
    if (!chance(0.5)) continue;
    expandMothershipCapacity(ai, kind);
    return true;
  }

  const prefer: MothershipModuleId[] =
    arch === "aggressor"
      ? ["reactor", "command", "engines", "hangar", "hull", "armor", "sensors"]
      : arch === "turtle"
        ? ["armor", "reactor", "hull", "command", "sensors", "hangar", "engines"]
        : arch === "farmer"
          ? [
              "engines",
              "hangar",
              "reactor",
              "hull",
              "armor",
              "command",
              "sensors",
            ]
          : [
              "sensors",
              "reactor",
              "command",
              "engines",
              "hangar",
              "armor",
              "hull",
            ];

  for (const part of prefer) {
    if (parts[part] >= 40) continue;
    const cost = mothershipPartUpgradeCost(part, parts[part]);
    if (ai.naquadah < cost + reserve) continue;
    if (!chance(0.5)) continue;
    ai.naquadah -= cost;
    parts[part] += 1;
    ai.mothership = recomputeMothership(ms);
    return true;
  }
  return false;
}

function tryPlanet(save: GameSave, ai: Realm) {
  if ((ai.mothership?.tier ?? 0) < 1 || ai.attackTurns < 5) return false;
  const planets = save.planets ?? [];
  const fleet =
    strikeAction(ai, planets, social(ai, save)) * 0.35 +
    (ai.mothership?.power ?? 0) +
    mothershipConquerBonus(ai);
  const candidates = planets
    .filter((p) => {
      if (p.ownerId === ai.id) return false;
      if (!p.ownerId) return true;
      const owner = save.realms.find((r) => r.id === p.ownerId);
      return !owner || !isFriendly(save, ai, owner);
    })
    .map((p) => ({
      p,
      score:
        fleet > p.defenceRating * 1.05
          ? p.miningYield * 2 + p.upYield * 40 - p.defenceRating * 0.02
          : -1,
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!candidates.length) return false;
  try {
    const log = resolvePlanetConquer(ai, candidates[0]!.p, planets);
    save.logs.attacks.unshift(log);
    return log.won;
  } catch {
    return false;
  }
}

function tryHostile(
  save: GameSave,
  ai: Realm,
  forced?: "attack" | "raid" | "spy" | "sabotage" | "assassinate",
) {
  if (forced === "spy" || forced === "sabotage" || forced === "assassinate") {
    if (ai.covertCapacity < 1 || ai.units.covert < 1) return false;
    const targets = sampleHostileTargets(save, ai, 32);
    if (!targets.length) return false;
    const target =
      forced === "sabotage"
        ? pick(
            [...targets]
              .sort(
                (a, b) =>
                  b.weapons.reduce((s, w) => s + w.quantity * w.power, 0) -
                  a.weapons.reduce((s, w) => s + w.quantity * w.power, 0),
              )
              .slice(0, 6),
          )
        : pick(targets);
    const agents = Math.min(
      ai.units.covert,
      Math.max(3, Math.floor(ai.units.covert * 0.3)),
    );
    try {
      if (forced === "spy") {
        save.logs.intelligence.unshift(resolveSpy(ai, target, agents).log);
        pushAction(ai, `Spied on ${target.name}`);
      } else if (forced === "sabotage") {
        save.logs.intelligence.unshift(resolveSabotage(ai, target, agents).log);
        pushAction(ai, `Sabotaged ${target.name}`);
      } else {
        save.logs.intelligence.unshift(
          resolveAssassinate(ai, target, agents).log,
        );
        pushAction(ai, `Assassinated on ${target.name}`);
      }
      return true;
    } catch {
      return false;
    }
  }

  const pickTarget = bestAttackTarget(ai, save);
  if (!pickTarget) return false;

  // Prefer eradication when ≥10× and turns allow
  if (
    canAttemptEradication(ai, pickTarget.target, save.planets ?? []) &&
    ai.attackTurns >= ERADICATION_TURN_COST &&
    eradicationPowerRatio(ai, pickTarget.target, save.planets ?? []) >= 10 &&
    chance(0.45)
  ) {
    try {
      const { log } = resolveEradication(
        ai,
        pickTarget.target,
        save.planets ?? [],
        save,
      );
      save.logs.attacks.unshift(log);
      pushAction(
        ai,
        log.eradicated
          ? `Eradicated ${pickTarget.target.name}`
          : `Failed eradicate ${pickTarget.target.name}`,
      );
      return true;
    } catch {
      /* fall through */
    }
  }

  const turns = Math.min(
    ai.attackTurns,
    pickTarget.kind === "raid" ? randInt(4, 12) : randInt(6, 15),
  );
  try {
    const { log } = resolveAttack(
      ai,
      pickTarget.target,
      turns,
      forced === "raid" ? "raid" : pickTarget.kind,
      save.planets ?? [],
      save,
    );
    save.logs.attacks.unshift(log);
    const kind = forced === "raid" ? "raid" : pickTarget.kind;
    pushAction(
      ai,
      `${log.won ? "Won" : "Lost"} ${kind} vs ${pickTarget.target.name}`,
    );
    return true;
  } catch {
    return false;
  }
}

/** Fund shared guild UP / mining when flush — benefits all members. */
function tryFundGuildTech(
  save: GameSave,
  ai: Realm,
  arch: AiArchetype,
): boolean {
  if (!ai.allianceId) return false;
  const alliance = getAlliance(save, ai.allianceId);
  if (!alliance) return false;
  const tech = ensureGuildTech(alliance);

  const preferMining =
    arch === "farmer" ||
    ai.factionId === "naq_cartel" ||
    (arch === "turtle" && chance(0.55));
  const preferUp =
    arch === "aggressor" ||
    ai.factionId === "iron_swarm" ||
    (arch === "covert" && chance(0.4));

  const order: GuildTechBranch[] = preferMining
    ? ["mining", "up"]
    : preferUp
      ? ["up", "mining"]
      : chance(0.5)
        ? ["up", "mining"]
        : ["mining", "up"];

  // Keep a personal reserve; contribute when next level is affordable
  const reserve =
    arch === "farmer" ? 800 : arch === "aggressor" ? 1200 : 1000;

  for (const branch of order) {
    const cost = guildTechUpgradeCost(branch, tech[branch]);
    if (ai.naquadah < cost + reserve) continue;
    // Don't dump everything into guild if personal UP is still cheap
    if (branch === "up") {
      const personalUp = upUpgradeCost(ai.unitProductionLevel);
      if (personalUp < cost * 0.55 && chance(0.65)) continue;
    }
    // Contribute more often when guild tech lags personal growth
    const lag =
      branch === "up"
        ? ai.unitProductionLevel - tech.up
        : ensureTech(ai).mining - tech.mining;
    const will =
      lag > 3 ? 0.75 : lag > 0 ? 0.45 : arch === "farmer" ? 0.35 : 0.22;
    if (!chance(will)) continue;
    try {
      upgradeGuildTech(save, ai, branch);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

function tryDepositGuildFund(
  save: GameSave,
  ai: Realm,
  arch: AiArchetype,
): boolean {
  const alliance = getAlliance(save, ai.allianceId);
  if (!alliance) return false;
  ensureGuildFund(alliance);
  const reserve =
    arch === "farmer" ? 1500 : arch === "turtle" ? 2000 : 900;
  const spare = ai.naquadah - reserve;
  if (spare < 200) return false;
  const amount = Math.min(
    spare,
    randInt(200, Math.max(200, Math.floor(spare * (arch === "farmer" ? 0.35 : 0.2)))),
  );
  if (amount < 100) return false;
  try {
    depositGuildFund(save, ai, amount);
    return true;
  } catch {
    return false;
  }
}

/**
 * Self-interested fleet clustering: join when the shared shield helps,
 * leave when carrying dead weight in peacetime or stuck solo.
 */
function manageFleetCluster(
  save: GameSave,
  ai: Realm,
  arch: AiArchetype,
): boolean {
  if (!ai.allianceId || ai.dead || ai.vacation) return false;

  const planets = save.planets ?? [];
  const atWar = warsForGuild(save, ai.allianceId).length > 0;
  const myDef = defenceAction(ai, planets, social(ai, save));
  const myStrike = strikeAction(ai, planets, social(ai, save));
  const wealth = ai.naquadah + ai.bankNaquadah;
  const current = getClusterForRealm(save, ai.id);

  // --- Already clustered: decide whether to stay or leave ---
  if (current) {
    const living = clusterLivingMembers(save, current);
    const others = living.filter((m) => m.id !== ai.id);
    const othersDef = others.reduce(
      (s, m) => s + defenceAction(m, planets, social(m, save)),
      0,
    );
    const avgOtherDef = others.length
      ? othersDef / others.length
      : 0;

    let leaveScore = 0;
    // Solo cluster is pointless
    if (others.length === 0) leaveScore += 12;
    // Peacetime: aggressors / covert don't babysit weak fleets
    if (!atWar) {
      leaveScore += 2;
      if (arch === "aggressor") leaveScore += 4;
      if (arch === "covert") leaveScore += 3;
      if (arch === "farmer" && wealth < 2000) leaveScore += 2;
      // Carrying much weaker mates with no war threat
      if (others.length && myDef > avgOtherDef * 2.5) leaveScore += 3;
    }
    // Wartime / turtle / fragile: stay
    if (atWar) leaveScore -= 10;
    if (arch === "turtle") leaveScore -= 6;
    if (myDef < myStrike * 0.55) leaveScore -= 4; // glass cannon — keep the shield
    if (wealth > 8000) leaveScore -= 3; // protect the bank
    if (others.length >= 3 && othersDef > myDef) leaveScore -= 4; // good company

    if (leaveScore >= 5 && chance(0.55 + Math.min(0.35, leaveScore * 0.04))) {
      try {
        leaveFleetCluster(save, ai);
        pushAction(
          ai,
          others.length === 0
            ? "Left empty fleet cluster"
            : atWar
              ? "Left fleet cluster"
              : "Left fleet cluster (peacetime)",
        );
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  // --- Not clustered: decide whether to join or start ---
  const existing = getClusterForGuild(save, ai.allianceId);
  let joinScore = 0;

  if (atWar) joinScore += 8;
  if (arch === "turtle") joinScore += 5;
  if (arch === "farmer") joinScore += 2;
  if (arch === "aggressor") joinScore += atWar ? 2 : -3;
  if (arch === "covert") joinScore += atWar ? 3 : -2;

  // Fragile or rich — want the shield
  if (myDef < 80) joinScore += 3;
  if (myDef < myStrike * 0.6) joinScore += 3;
  if (wealth > 5000) joinScore += 2;
  if (wealth > 15000) joinScore += 2;

  if (existing) {
    const living = clusterLivingMembers(save, existing);
    if (living.length >= FLEET_CLUSTER_MAX) return false;
    const clusterDef = living.reduce(
      (s, m) => s + defenceAction(m, planets, social(m, save)),
      0,
    );
    const avg = living.length ? clusterDef / living.length : 0;
    // Stronger mates = better join; weak-only cluster is less appealing unless at war
    if (avg > myDef * 1.15) joinScore += 4;
    else if (avg < myDef * 0.45 && !atWar) joinScore -= 3;
    if (living.length >= 2) joinScore += 2;
    if (living.length >= 5 && atWar) joinScore += 2;

    if (joinScore < 4) return false;
    if (!chance(0.4 + Math.min(0.5, joinScore * 0.05))) return false;

    try {
      joinFleetCluster(save, ai, existing.id);
      pushAction(
        ai,
        `Joined fleet cluster (${living.length + 1}/${FLEET_CLUSTER_MAX})`,
      );
      return true;
    } catch {
      return false;
    }
  }

  // No cluster yet — start one if it's worth leading
  let startScore = joinScore;
  if (arch === "turtle") startScore += 2;
  if (atWar) startScore += 3;
  if (arch === "aggressor" && !atWar) startScore -= 4;
  // Need some personal defence to be worth clustering around
  if (myDef < 40 && !atWar) startScore -= 2;
  if (startScore < 6) return false;
  if (!chance(0.35 + Math.min(0.4, startScore * 0.04))) return false;

  try {
    startFleetCluster(save, ai);
    pushAction(ai, "Started fleet cluster");
    return true;
  } catch {
    return false;
  }
}

function tryGuildPolitics(save: GameSave, ai: Realm, arch: AiArchetype) {
  ensureAlliances(save);
  if (!ai.factionId || ai.factionId === "unaligned") {
    ai.factionId = pickFactionForRealm(ai);
  }

  if (ai.allianceId) {
    // Already in a guild — sometimes top up the shared fund, else fund tech
    if (chance(0.28) && tryDepositGuildFund(save, ai, arch)) return true;
    return tryFundGuildTech(save, ai, arch);
  }

  const best = bestGuildToJoin(save, ai);
  const myPowerApprox = ai.unitProductionLevel * 50 + ai.naquadah * 0.01;

  // Found a guild if rich enough and no great join option (or aggressor leaders)
  const canFound = ai.naquadah >= ALLIANCE_CREATE_COST;
  const wantFound =
    canFound &&
    (!best ||
      (arch === "aggressor" && myPowerApprox > 400 && chance(0.35)) ||
      (arch === "farmer" && chance(0.12)));

  if (wantFound) {
    try {
      createAlliance(save, ai, randomGuildName(save.alliances.length), {
        factionId: ai.factionId,
        joinMode: chance(0.7) ? "open" : "invite",
      });
      const g = getAlliance(save, ai.allianceId);
      pushAction(
        ai,
        g ? `Founded guild [${g.tag}] ${g.name}` : "Founded a guild",
      );
      return true;
    } catch {
      /* fall through to join */
    }
  }

  if (best) {
    try {
      joinAlliance(save, ai, best.id);
      pushAction(ai, `Joined guild [${best.tag}] ${best.name}`);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function tryAscendIfReady(ai: Realm): boolean {
  const req = ascensionRequirements(ai);
  if (!req.ready) return false;
  try {
    performAscension(ai);
    pushAction(ai, `Ascended to level ${ai.ascensionLevel}`);
    return true;
  } catch {
    return false;
  }
}

function prepareForAscension(ai: Realm, arch: AiArchetype) {
  const req = ascensionRequirements(ai);
  if (!req.gloryOk) return false;
  // Pull bank to open Naq if short
  if (!req.naqOk && ai.bankNaquadah > 0) {
    const need = req.naqNeeded - (ai.naquadah + ai.bankNaquadah);
    if (need <= 0) {
      const take = Math.min(ai.bankNaquadah, req.naqNeeded - ai.naquadah);
      if (take > 0) {
        ai.bankNaquadah -= take;
        ai.naquadah += take;
      }
    }
  }
  if (!req.upOk) {
    const cost = upUpgradeCost(ai.unitProductionLevel);
    if (ai.naquadah >= cost) {
      ai.naquadah -= cost;
      ai.unitProductionLevel += 1;
      return true;
    }
  }
  if (!req.untrainedOk || !req.trainedOk) {
    trySmartTrain(ai, arch, true);
    return true;
  }
  return false;
}

function spendApIfUseful(save: GameSave, ai: Realm) {
  if ((ai.ascensionPoints ?? 0) < 20) return false;
  // Prefer UP when climbing, else tech
  const sink = ai.unitProductionLevel < 20 ? "up" : chance(0.5) ? "tech" : "naq";
  const amount = Math.min(ai.ascensionPoints, randInt(20, 60));
  return spendAscensionPoints(save, ai.id, amount, sink) == null;
}

/**
 * Self-interested entity brain: grow → socialize → dominate → ascend.
 * Spends liquid Naq aggressively each pulse on income and combat stats.
 */
function runAiBrain(save: GameSave, ai: Realm) {
  const arch = hashArchetype(ai.id);
  const planets = save.planets ?? [];
  const req = ascensionRequirements(ai);
  const nearAscend = req.gloryOk && (!req.ready || chance(0.8));
  const mind = ensureMind(ai);
  const hasPlan = mind.plan.some((s) => !s.done);

  // 0) Ascend immediately when fully ready
  if (tryAscendIfReady(ai)) {
    spendApIfUseful(save, ai);
    return;
  }

  // 1) Baseline army economy ALWAYS runs — LLM plans often skip train/weapons
  //    and used to gate these behind personaLed, leaving AIs with piles of UU.
  tryRepair(ai);
  if (ai.units.untrained > 2) trySmartTrain(ai, arch, nearAscend);
  trySmartBuyWeapon(ai);
  // Train created new unarmed troops — arm them
  trySmartBuyWeapon(ai);

  // 1b) Execute LLM plan steps — personas follow through with remaining Naq
  if (hasPlan) {
    executeAiPlan(save, ai, 5);
  }

  // When a fresh LLM plan exists, keep heuristics light so the persona leads
  const personaLed = hasPlan && (mind.thinkCount ?? 0) > 0;

  // 1c) Top up army after plan spent (or failed to include train/buy)
  tryRepair(ai);
  if (ai.units.untrained > 2) trySmartTrain(ai, arch, nearAscend);
  trySmartBuyWeapon(ai);

  // 2) Guild / faction politics (self-interest)
  if (!personaLed) {
    // Fleet clusters: evaluate join/leave every pulse when guilded
    if (ai.allianceId && chance(0.55)) manageFleetCluster(save, ai, arch);
    if (!ai.allianceId && chance(0.55)) tryGuildPolitics(save, ai, arch);
    else if (!ai.allianceId && ai.naquadah > ALLIANCE_CREATE_COST * 0.5) {
      tryGuildPolitics(save, ai, arch);
    } else if (ai.allianceId && chance(0.4)) {
      tryFundGuildTech(save, ai, arch);
    }
    if (ai.allianceId && chance(0.18)) tryAiDeclareWar(save, ai);
    if (ai.allianceId && chance(0.1)) tryAiEndWar(save, ai);
  } else if (ai.allianceId) {
    if (chance(0.25)) manageFleetCluster(save, ai, arch);
    if (chance(0.08)) tryFundGuildTech(save, ai, arch);
  }

  // 2b) Donation contracts — request / fulfill every pulse when useful
  if (!personaLed || chance(0.25)) tryDonationContracts(save, ai, arch);

  // 2c) Open Market — buy bargains / sell surplus for advantage
  if (!personaLed || chance(0.35)) tryMarketAdvantage(save, ai, arch);

  // 3) Prepare ascension stockpile when G&R unlocked
  if (nearAscend) prepareForAscension(ai, arch);

  // 4) Aggressive permanent upgrades — prioritize UP / mining income
  //    (army already topped up above so upgrades don't starve training)
  tryAggressiveUpgrades(ai, arch, personaLed ? 2 : nearAscend ? 3 : 5);

  // 5b) Extra guild tech contribution when flush
  if (ai.allianceId && ai.naquadah > 4000 && chance(0.35)) {
    tryFundGuildTech(save, ai, arch);
  }

  // 6) Mothership / planets
  if ((ai.mothership?.tier ?? 0) < 1 && ai.naquadah > 2500) tryMothership(ai, arch);
  else if ((ai.mothership?.tier ?? 0) >= 1) {
    tryPlanet(save, ai);
    if (chance(0.35)) tryMothershipParts(ai, arch);
    if (chance(0.2)) tryMothership(ai, arch);
  }

  // 7) Spend AP leftovers
  spendApIfUseful(save, ai);

  // 8) Guild war campaign — prioritize wartime enemies hard
  const inGuildWar =
    !!ai.allianceId && warsForGuild(save, ai.allianceId).length > 0;
  if (inGuildWar) {
    tryWarCampaign(save, ai, arch);
  }

  // 8b) Domination — hit everyone beatable (not allies); wartime already boosted in scoring
  const canCrush = bestAttackTarget(ai, save) != null;
  const myStrike = strikeAction(ai, planets, social(ai, save));
  const myDef = defenceAction(ai, planets, social(ai, save));

  if (canCrush && ai.attackTurns < 6 && chance(0.55)) {
    tryMarketAdvantage(save, ai, arch);
  }

  if (canCrush && ai.attackTurns >= 2) {
    const waves = Math.min(
      inGuildWar ? 4 : 3,
      Math.floor(ai.attackTurns / (inGuildWar ? 4 : 5)),
    );
    for (let i = 0; i < Math.max(1, waves); i++) {
      if (!tryHostile(save, ai)) break;
    }
  } else if (arch === "covert" && ai.covertCapacity >= 1) {
    if (chance(0.5)) tryHostile(save, ai, "sabotage");
    else tryHostile(save, ai, "spy");
  } else if (arch === "turtle" && myDef < myStrike * 0.85) {
    trySmartTrain(ai, "turtle", false);
    tryAggressiveUpgrades(ai, "turtle", 5);
  }

  // 9) Drain remaining liquid into growth (income first)
  spendEverythingUseful(ai, arch, save);
  if (ai.units.untrained > 8) trySmartTrain(ai, arch, nearAscend);

  // 9b) Occasional second market pass (was every other pulse — too hot at scale)
  if (chance(0.2)) tryMarketAdvantage(save, ai, arch);

  // 10) Bank only leftover after growth spending
  if (ai.naquadah > 2500) trySmartDeposit(ai, save, nearAscend && !req.naqOk);

  // Re-check ascend at end of pulse
  tryAscendIfReady(ai);
}

export function aiPulseIntervalMs(save: GameSave): number {
  const perHour = Math.max(
    1,
    save.settings.aiPulsesPerHour ?? DEFAULT_AI_PULSES_PER_HOUR,
  );
  return Math.floor((60 * 60 * 1000) / perHour);
}

export function catchUpAi(
  save: GameSave,
  now = Date.now(),
  /** Cap pulses per call so UI stays responsive (remaining catch up next tick). */
  maxPulses = MAX_AI_CATCHUP,
): number {
  if (
    save.settings.aiEnabled === false &&
    !save.settings.playerAiEnabled
  ) {
    return 0;
  }
  if (!save.lastAiPulseAt) save.lastAiPulseAt = save.lastTickAt || now;

  const interval = aiPulseIntervalMs(save);
  const elapsed = now - save.lastAiPulseAt;
  let pulses = Math.floor(elapsed / interval);
  pulses = clamp(pulses, 0, Math.min(MAX_AI_CATCHUP, maxPulses));
  if (pulses <= 0) return 0;

  for (let p = 0; p < pulses; p++) runAiPulse(save);

  save.lastAiPulseAt += pulses * interval;
  if (save.lastAiPulseAt > now) save.lastAiPulseAt = now;
  return pulses;
}

export type AiPulseBatch = {
  actors: Realm[];
  player: Realm | null;
};

let aiPulseSerial = 0;

/**
 * Setup for one AI pulse: population, optional guild prune, round-robin batch.
 * Brains are run separately so the scheduler can yield between actors.
 */
export function prepareAiPulse(save: GameSave): AiPulseBatch {
  ensureAlliances(save);
  aiPulseSerial += 1;
  // Full guild prune is O(realms); do it every ~10 pulses, not every pulse
  if (aiPulseSerial % 10 === 1) pruneEmptyGuilds(save);
  ensureAiPopulation(save, TARGET_AI_COUNT, AI_POPULATION_BATCH);

  const rivalsOn = save.settings.aiEnabled !== false;
  let actors: Realm[] = [];
  if (rivalsOn) {
    const count = clampAiActorsPerPulse(
      save.settings.aiActorsPerPulse ?? DEFAULT_AI_ACTORS_PER_PULSE,
    );
    actors = takeNextLivingAis(save, count);
  }

  let player: Realm | null = null;
  if (save.settings.playerAiEnabled) {
    const p = save.realms.find((r) => r.id === save.playerId);
    if (p && !p.dead && !p.vacation) {
      ensureMind(p);
      player = p;
    }
  }

  return { actors, player };
}

export function runPreparedAiActor(save: GameSave, ai: Realm): void {
  runAiBrain(save, ai);
}

export function finalizeAiPulse(save: GameSave): void {
  maybeUniverseBlip(save, 0.35);
  if (!save.logs) save.logs = { attacks: [], intelligence: [] };
  const playerId = save.playerId;
  const attacks = save.logs.attacks ?? [];
  if (attacks.length > 400) {
    const playerRelated: typeof attacks = [];
    const other: typeof attacks = [];
    for (const l of attacks) {
      if (
        l.attackerId === playerId ||
        l.defenderId === playerId ||
        (l.kind === "planet" && l.attackerId === playerId)
      ) {
        playerRelated.push(l);
      } else {
        other.push(l);
      }
    }
    const keepPlayer = playerRelated.slice(0, 120);
    const room = Math.max(0, 400 - keepPlayer.length);
    save.logs.attacks = keepPlayer.concat(other.slice(0, room));
  }
  if ((save.logs.intelligence?.length ?? 0) > 200) {
    save.logs.intelligence = save.logs.intelligence.slice(0, 200);
  }
}

export function runAiPulse(save: GameSave): number {
  const batch = prepareAiPulse(save);
  for (const ai of batch.actors) runAiBrain(save, ai);
  if (batch.player) runAiBrain(save, batch.player);
  finalizeAiPulse(save);
  return batch.actors.length + (batch.player ? 1 : 0);
}

export function forceAiPulse(save: GameSave): number {
  const n = runAiPulse(save);
  save.lastAiPulseAt = Date.now();
  return n;
}

export function msUntilNextAiPulse(save: GameSave, now = Date.now()): number {
  if (
    save.settings.aiEnabled === false &&
    !save.settings.playerAiEnabled
  ) {
    return Number.POSITIVE_INFINITY;
  }
  const last = save.lastAiPulseAt ?? save.lastTickAt ?? now;
  return Math.max(0, last + aiPulseIntervalMs(save) - now);
}
