import type {
  Alliance,
  AllianceJoinMode,
  FactionId,
  GameSave,
  GuildTech,
  Realm,
} from "@/lib/db/schema";
import { overallRankScore, uid } from "@/lib/game/economy";
import { pushNews } from "@/lib/game/news";

export const FACTIONS: Record<
  FactionId,
  { id: FactionId; name: string; blurb: string; color: string }
> = {
  gate_coalition: {
    id: "gate_coalition",
    name: "Gate Coalition",
    blurb: "Order through the network — defence & diplomacy",
    color: "#5aa8ff",
  },
  naq_cartel: {
    id: "naq_cartel",
    name: "Naq Cartel",
    blurb: "Wealth first — mining & banking power",
    color: "#ffb020",
  },
  shadow_lattice: {
    id: "shadow_lattice",
    name: "Shadow Lattice",
    blurb: "Espionage & sabotage specialists",
    color: "#b388ff",
  },
  iron_swarm: {
    id: "iron_swarm",
    name: "Iron Swarm",
    blurb: "Conquest doctrine — strike hard",
    color: "#ff6b6b",
  },
  unaligned: {
    id: "unaligned",
    name: "Unaligned",
    blurb: "No faction — free agents",
    color: "#8aa0b8",
  },
};

export const FACTION_LIST = Object.values(FACTIONS).filter(
  (f) => f.id !== "unaligned",
);

export const ALLIANCE_CREATE_COST = 100_000;

export type GuildTechBranch = keyof GuildTech;

export const DEFAULT_GUILD_TECH: GuildTech = { up: 0, mining: 0 };

export function ensureGuildTech(alliance: Alliance): GuildTech {
  if (!alliance.tech) alliance.tech = { ...DEFAULT_GUILD_TECH };
  if (alliance.tech.up == null) alliance.tech.up = 0;
  if (alliance.tech.mining == null) alliance.tech.mining = 0;
  return alliance.tech;
}

/** Cost for next level of a shared guild tech track. */
export function guildTechUpgradeCost(
  branch: GuildTechBranch,
  level: number,
): number {
  const base = branch === "up" ? 2500 : 2200;
  const growth = branch === "up" ? 1.42 : 1.4;
  return Math.floor(base * Math.pow(growth, Math.max(0, level)));
}

/**
 * Any member can fund the next shared level. Returns cost paid or throws.
 */
export function upgradeGuildTech(
  save: GameSave,
  realm: Realm,
  branch: GuildTechBranch,
): { cost: number; newLevel: number } {
  const alliance = getAlliance(save, realm.allianceId);
  if (!alliance) throw new Error("Not in a guild");
  if (!alliance.memberIds.includes(realm.id)) {
    throw new Error("Not a guild member");
  }
  const tech = ensureGuildTech(alliance);
  const cost = guildTechUpgradeCost(branch, tech[branch]);
  if (realm.naquadah < cost) {
    throw new Error(`Need ${cost.toLocaleString()} Naq`);
  }
  realm.naquadah -= cost;
  tech[branch] += 1;
  const label = branch === "up" ? "Unit Production" : "Mining";
  alliance.news.unshift(
    `${realm.name} funded Guild ${label} → Lv ${tech[branch]} (−${cost.toLocaleString()} Naq)`,
  );
  alliance.news = alliance.news.slice(0, 40);
  return { cost, newLevel: tech[branch] };
}

/** Flat UU/turn from guild UP tech. */
export function guildUpBonus(realm: Realm, save: GameSave): number {
  const alliance = getAlliance(save, realm.allianceId);
  if (!alliance) return 0;
  const tech = ensureGuildTech(alliance);
  return Math.floor(tech.up * (2 + tech.up * 0.15));
}

/** Multiplier for mining/Naq income from guild mining tech. */
export function guildMiningMult(realm: Realm, save: GameSave): number {
  const alliance = getAlliance(save, realm.allianceId);
  if (!alliance) return 1;
  const tech = ensureGuildTech(alliance);
  return 1 + tech.mining * 0.04;
}

const GUILD_NAME_A = [
  "Obsidian",
  "Crimson",
  "Silent",
  "Solar",
  "Void",
  "Jade",
  "Iron",
  "Echo",
  "Nova",
  "Rift",
  "Ashen",
  "Quantum",
];
const GUILD_NAME_B = [
  "Pact",
  "Legion",
  "Syndicate",
  "Order",
  "Cabal",
  "Dominion",
  "Circle",
  "Phalanx",
  "Consortium",
  "Mandate",
  "Host",
  "Union",
];

export function factionOf(realm: Realm): FactionId {
  return realm.factionId ?? "unaligned";
}

export function sameAlliance(a: Realm, b: Realm): boolean {
  return !!(a.allianceId && a.allianceId === b.allianceId);
}

export function sameFaction(a: Realm, b: Realm): boolean {
  const fa = factionOf(a);
  const fb = factionOf(b);
  return fa !== "unaligned" && fa === fb;
}

export function allianceCombatBonus(realm: Realm, save: GameSave): number {
  let bonus = 1;
  const alliance = getAlliance(save, realm.allianceId);
  if (alliance) {
    const members = Math.min(alliance.memberIds.length, 40);
    bonus += members * 0.004;
  }
  const f = factionOf(realm);
  if (f === "iron_swarm") bonus += 0.04;
  if (f === "gate_coalition") bonus += 0.03;
  return bonus;
}

export function allianceIncomeBonus(realm: Realm, save: GameSave): number {
  let bonus = 1;
  const alliance = getAlliance(save, realm.allianceId);
  if (alliance) {
    const members = Math.min(alliance.memberIds.length, 40);
    bonus += members * 0.003;
  }
  if (factionOf(realm) === "naq_cartel") bonus += 0.06;
  bonus *= guildMiningMult(realm, save);
  return bonus;
}

export function getAlliance(
  save: GameSave,
  id?: string | null,
): Alliance | undefined {
  if (!id) return undefined;
  return (save.alliances ?? []).find((a) => a.id === id);
}

/** Per-save realm id index — rebuilt when the realms array grows/shrinks. */
const realmIndexCache = new WeakMap<
  GameSave,
  { realms: Realm[]; size: number; map: Map<string, Realm> }
>();

export function getRealmIndex(save: GameSave): Map<string, Realm> {
  const cached = realmIndexCache.get(save);
  if (
    cached &&
    cached.realms === save.realms &&
    cached.size === save.realms.length
  ) {
    return cached.map;
  }
  const map = new Map<string, Realm>();
  for (const r of save.realms) map.set(r.id, r);
  realmIndexCache.set(save, {
    realms: save.realms,
    size: save.realms.length,
    map,
  });
  return map;
}

/** Call after pushing/removing realms so lookups stay correct. */
export function indexRealm(save: GameSave, realm: Realm): void {
  const map = getRealmIndex(save);
  map.set(realm.id, realm);
  const cached = realmIndexCache.get(save);
  if (cached) cached.size = save.realms.length;
}

/** Living members only — O(members), not O(all realms). */
export function allianceMembers(save: GameSave, alliance: Alliance): Realm[] {
  const byId = getRealmIndex(save);
  const out: Realm[] = [];
  for (const id of alliance.memberIds) {
    const r = byId.get(id);
    if (r && !r.dead) out.push(r);
  }
  return out;
}

function endWarsForAlliance(save: GameSave, allianceId: string): void {
  if (!save.wars?.length) return;
  const now = Date.now();
  for (const war of save.wars) {
    if (war.status !== "active") continue;
    if (
      war.attackerAllianceId !== allianceId &&
      war.defenderAllianceId !== allianceId
    ) {
      continue;
    }
    war.status = "ended";
    war.endedAt = now;
  }
}

function dissolveAlliance(
  save: GameSave,
  alliance: Alliance,
  opts?: { silent?: boolean },
): void {
  for (const id of [...alliance.memberIds]) {
    const r = save.realms.find((x) => x.id === id);
    if (r?.allianceId === alliance.id) r.allianceId = undefined;
  }
  endWarsForAlliance(save, alliance.id);
  save.alliances = (save.alliances ?? []).filter((a) => a.id !== alliance.id);
  if (!opts?.silent) {
    pushNews(
      save,
      "guild",
      `Guild dissolved — [${alliance.tag}] ${alliance.name}`,
    );
  }
}

/**
 * Drop dead/missing ids from guilds. Dissolve any guild with 0 living members.
 * Safe to call from migrate / rankings / AI ticks.
 */
export function pruneEmptyGuilds(save: GameSave): number {
  if (!save.alliances) save.alliances = [];
  let dissolved = 0;
  const byId = getRealmIndex(save);
  const allianceById = new Map(
    save.alliances.map((a) => [a.id, a] as const),
  );

  for (const realm of save.realms) {
    if (!realm.allianceId) continue;
    if (realm.dead || !allianceById.has(realm.allianceId)) {
      realm.allianceId = undefined;
    }
  }

  for (const alliance of [...save.alliances]) {
    const livingIds: string[] = [];
    for (const id of alliance.memberIds) {
      const r = byId.get(id);
      if (r && !r.dead) livingIds.push(id);
    }
    alliance.memberIds = livingIds;

    if (livingIds.length === 0) {
      dissolveAlliance(save, alliance, { silent: false });
      dissolved += 1;
      continue;
    }

    if (!livingIds.includes(alliance.leaderId)) {
      const members = allianceMembers(save, alliance);
      const byId = save.rankingsCache?.byId;
      members.sort((a, b) => {
        const sb = byId?.[b.id]?.overall ?? overallRankScore(b, save.planets ?? []);
        const sa = byId?.[a.id]?.overall ?? overallRankScore(a, save.planets ?? []);
        return sb - sa;
      });
      alliance.leaderId = members[0]!.id;
      alliance.news.unshift(`${members[0]!.name} is the new leader.`);
      alliance.news = alliance.news.slice(0, 40);
    }
  }

  return dissolved;
}

/** Sum of member overall scores — total guild power. */
export function guildTotalPower(save: GameSave, alliance: Alliance): number {
  const cached = save.rankingsCache?.guilds.find(
    (g) => g.allianceId === alliance.id,
  );
  if (cached) return cached.power;

  const byId = save.rankingsCache?.byId;
  if (byId) {
    let power = 0;
    for (const m of allianceMembers(save, alliance)) {
      power += byId[m.id]?.overall ?? 0;
    }
    return power;
  }

  const planets = save.planets ?? [];
  return allianceMembers(save, alliance).reduce(
    (sum, m) => sum + overallRankScore(m, planets),
    0,
  );
}

export interface GuildRankRow {
  alliance: Alliance;
  rank: number;
  power: number;
  members: number;
  avgPower: number;
  techUp: number;
  techMining: number;
  leaderName: string;
}

/** Rank all guilds by total member power (from rankings cache). */
export function buildGuildRankings(save: GameSave): GuildRankRow[] {
  const cache = save.rankingsCache;
  if (!cache?.guilds?.length) return [];
  const allianceById = new Map(
    ensureAlliances(save).map((a) => [a.id, a] as const),
  );
  const rows: GuildRankRow[] = [];
  for (const g of cache.guilds) {
    const alliance = allianceById.get(g.allianceId);
    if (!alliance) continue;
    rows.push({
      alliance,
      rank: g.rank,
      power: g.power,
      members: g.members,
      avgPower: g.avgPower,
      techUp: g.techUp,
      techMining: g.techMining,
      leaderName: g.leaderName,
    });
  }
  return rows;
}

export function ensureAlliances(save: GameSave): Alliance[] {
  if (!save.alliances) save.alliances = [];
  for (const a of save.alliances) {
    ensureGuildTech(a);
    ensureGuildFund(a);
  }
  return save.alliances;
}

/** Shared treasury balance (Naq). */
export function ensureGuildFund(alliance: Alliance): number {
  if (alliance.fund == null || !Number.isFinite(alliance.fund) || alliance.fund < 0) {
    alliance.fund = 0;
  }
  return alliance.fund;
}

/** Per-turn dividend rate paid from the guild fund to living members. */
export const GUILD_FUND_DIVIDEND_RATE = 0.005;

/** Estimated Naq one living member receives from the fund this turn. */
export function guildFundDividendPerMember(
  save: GameSave,
  alliance: Alliance,
): number {
  const fund = ensureGuildFund(alliance);
  const members = allianceMembers(save, alliance);
  if (!members.length || fund < 1) return 0;
  const pool = Math.floor(fund * GUILD_FUND_DIVIDEND_RATE);
  if (pool < 1) return 0;
  return Math.floor(pool / members.length);
}

/** Dividend income for a realm from their guild fund (0 if none). */
export function guildFundIncome(realm: Realm, save: GameSave): number {
  const alliance = getAlliance(save, realm.allianceId);
  if (!alliance) return 0;
  return guildFundDividendPerMember(save, alliance);
}

/**
 * Pay 0.5% of each guild fund, split equally among living members.
 * Deducts the paid total from the fund.
 */
export function payGuildFundDividends(save: GameSave): void {
  for (const alliance of ensureAlliances(save)) {
    const members = allianceMembers(save, alliance);
    const fund = ensureGuildFund(alliance);
    if (!members.length || fund < 1) continue;
    const pool = Math.floor(fund * GUILD_FUND_DIVIDEND_RATE);
    const each = Math.floor(pool / members.length);
    if (each < 1) continue;
    const paid = each * members.length;
    alliance.fund = Math.max(0, fund - paid);
    for (const m of members) m.naquadah += each;
  }
}

export function depositGuildFund(
  save: GameSave,
  realm: Realm,
  amount: number,
): number {
  const alliance = getAlliance(save, realm.allianceId);
  if (!alliance) throw new Error("Not in a guild");
  if (!alliance.memberIds.includes(realm.id)) {
    throw new Error("Not a guild member");
  }
  if (realm.dead) throw new Error("Dead realms cannot deposit");
  const n = Math.floor(amount);
  if (n < 1) throw new Error("Invalid amount");
  if (realm.naquadah < n) throw new Error("Not enough open Naq");
  ensureGuildFund(alliance);
  realm.naquadah -= n;
  alliance.fund += n;
  alliance.news.unshift(
    `${realm.name} deposited ${n.toLocaleString()} Naq into the guild fund`,
  );
  alliance.news = alliance.news.slice(0, 40);
  return n;
}

/** Any living member may withdraw any amount up to the fund balance. */
export function withdrawGuildFund(
  save: GameSave,
  realm: Realm,
  amount: number,
): number {
  const alliance = getAlliance(save, realm.allianceId);
  if (!alliance) throw new Error("Not in a guild");
  if (!alliance.memberIds.includes(realm.id)) {
    throw new Error("Not a guild member");
  }
  if (realm.dead) throw new Error("Dead realms cannot withdraw");
  const fund = ensureGuildFund(alliance);
  const n = Math.floor(amount);
  if (n < 1) throw new Error("Invalid amount");
  if (fund < n) throw new Error("Guild fund is too low");
  alliance.fund -= n;
  realm.naquadah += n;
  alliance.news.unshift(
    `${realm.name} withdrew ${n.toLocaleString()} Naq from the guild fund`,
  );
  alliance.news = alliance.news.slice(0, 40);
  return n;
}

function makeTag(name: string, index: number): string {
  const letters = name
    .replace(/[^A-Za-z]/g, "")
    .slice(0, 3)
    .toUpperCase();
  return `${letters || "GLD"}${index % 100}`.slice(0, 5);
}

export function createAlliance(
  save: GameSave,
  leader: Realm,
  name: string,
  opts?: {
    factionId?: FactionId;
    joinMode?: AllianceJoinMode;
    free?: boolean;
  },
): Alliance {
  ensureAlliances(save);
  if (leader.dead) throw new Error("Dead realms cannot found guilds");
  if (leader.allianceId) {
    throw new Error("Already in a guild");
  }
  const cost = opts?.free ? 0 : ALLIANCE_CREATE_COST;
  if (leader.naquadah < cost) {
    throw new Error(
      `Need ${ALLIANCE_CREATE_COST.toLocaleString()} Naq to found a guild`,
    );
  }
  leader.naquadah -= cost;

  const factionId =
    opts?.factionId ??
    (leader.factionId && leader.factionId !== "unaligned"
      ? leader.factionId
      : pickFactionForRealm(leader));

  leader.factionId = factionId;

  const alliance: Alliance = {
    id: uid("guild"),
    name: name.trim().slice(0, 32) || "Nameless Pact",
    tag: makeTag(name, save.alliances.length),
    leaderId: leader.id,
    factionId,
    joinMode: opts?.joinMode ?? "open",
    createdAt: Date.now(),
    memberIds: [leader.id],
    news: [`${leader.name} founded the guild.`],
    tech: { ...DEFAULT_GUILD_TECH },
    fund: 0,
  };
  save.alliances.push(alliance);
  leader.allianceId = alliance.id;
  pushNews(
    save,
    "guild",
    `Guild founded — [${alliance.tag}] ${alliance.name} by ${leader.name}`,
  );
  return alliance;
}

export function joinAlliance(
  save: GameSave,
  realm: Realm,
  allianceId: string,
): void {
  const alliance = getAlliance(save, allianceId);
  if (!alliance) throw new Error("Guild not found");
  if (realm.dead) throw new Error("Dead realms cannot join guilds");
  if (realm.allianceId === allianceId) throw new Error("Already in this guild");
  if (alliance.joinMode === "closed") throw new Error("Guild is closed");
  // Prune husks so capacity reflects living members only
  alliance.memberIds = alliance.memberIds.filter((id) => {
    const r = save.realms.find((x) => x.id === id);
    return Boolean(r) && !r!.dead;
  });
  if (alliance.memberIds.length >= 80) throw new Error("Guild is full");
  if (alliance.memberIds.length === 0) {
    dissolveAlliance(save, alliance);
    throw new Error("Guild no longer exists");
  }

  const from = realm.allianceId
    ? getAlliance(save, realm.allianceId)
    : undefined;
  const fromTag = from?.tag ?? null;
  if (realm.allianceId) leaveAlliance(save, realm, { silent: true });

  ensureGuildTech(alliance);
  alliance.memberIds.push(realm.id);
  realm.allianceId = alliance.id;
  realm.factionId = alliance.factionId;
  alliance.news.unshift(`${realm.name} joined the guild.`);
  alliance.news = alliance.news.slice(0, 40);
  pushNews(
    save,
    "guild",
    fromTag
      ? `${realm.name} defected [${fromTag}] → [${alliance.tag}] ${alliance.name}`
      : `${realm.name} joined [${alliance.tag}] ${alliance.name}`,
  );
}

export function leaveAlliance(
  save: GameSave,
  realm: Realm,
  opts?: { silent?: boolean },
): void {
  // Inline cluster drop — avoids circular import with fleetClusters.ts
  if (save.fleetClusters?.length) {
    for (const cluster of [...save.fleetClusters]) {
      if (!cluster.memberIds.includes(realm.id)) continue;
      cluster.memberIds = cluster.memberIds.filter((id) => id !== realm.id);
      if (cluster.memberIds.length === 0) {
        save.fleetClusters = save.fleetClusters.filter(
          (c) => c.id !== cluster.id,
        );
      } else if (
        cluster.leaderId === realm.id ||
        !cluster.memberIds.includes(cluster.leaderId)
      ) {
        cluster.leaderId = cluster.memberIds[0]!;
      }
    }
  }
  const alliance = getAlliance(save, realm.allianceId);
  if (!alliance) {
    realm.allianceId = undefined;
    return;
  }
  const tag = alliance.tag;
  const name = alliance.name;
  alliance.memberIds = alliance.memberIds.filter((id) => {
    if (id === realm.id) return false;
    const r = save.realms.find((x) => x.id === id);
    return Boolean(r) && !r!.dead;
  });
  alliance.news.unshift(
    opts?.silent
      ? `${realm.name} fell — removed from the guild.`
      : `${realm.name} left the guild.`,
  );
  alliance.news = alliance.news.slice(0, 40);
  realm.allianceId = undefined;
  if (!opts?.silent) {
    pushNews(save, "guild", `${realm.name} left [${tag}] ${name}`);
  }

  const members = allianceMembers(save, alliance);
  if (members.length === 0) {
    dissolveAlliance(save, alliance, { silent: opts?.silent });
    return;
  }
  if (alliance.leaderId === realm.id || !members.some((m) => m.id === alliance.leaderId)) {
    const byId = save.rankingsCache?.byId;
    members.sort((a, b) => {
      const sb = byId?.[b.id]?.overall ?? overallRankScore(b, save.planets ?? []);
      const sa = byId?.[a.id]?.overall ?? overallRankScore(a, save.planets ?? []);
      return sb - sa;
    });
    alliance.leaderId = members[0]!.id;
    alliance.news.unshift(`${members[0]!.name} is the new leader.`);
    if (!opts?.silent) {
      pushNews(
        save,
        "guild",
        `[${tag}] new leader — ${members[0]!.name}`,
      );
    }
  }
}

export function pickFactionForRealm(realm: Realm): FactionId {
  const archHint = realm.id.charCodeAt(realm.id.length - 1) % 4;
  const map: FactionId[] = [
    "gate_coalition",
    "naq_cartel",
    "shadow_lattice",
    "iron_swarm",
  ];
  if (realm.race === "asgard") return "gate_coalition";
  if (realm.race === "goauld") return "naq_cartel";
  if (realm.race === "replicator") return chancePick(map, archHint);
  if (realm.race === "tauri") return "iron_swarm";
  return map[archHint]!;
}

function chancePick(map: FactionId[], i: number): FactionId {
  return map[i % map.length]!;
}

export function randomGuildName(index: number): string {
  const a = GUILD_NAME_A[index % GUILD_NAME_A.length]!;
  const b =
    GUILD_NAME_B[Math.floor(index / GUILD_NAME_A.length) % GUILD_NAME_B.length]!;
  return `${a} ${b}`;
}

export function guildAttractiveness(
  save: GameSave,
  alliance: Alliance,
  prospect: Realm,
): number {
  if (alliance.joinMode === "closed") return -1;
  const members = allianceMembers(save, alliance);
  if (members.length >= 80) return -1;
  if (!members.length) return 0;
  const byId = save.rankingsCache?.byId;
  const power = members.reduce(
    (s, m) => s + (byId?.[m.id]?.overall ?? 0),
    0,
  );
  const avg = power / members.length;
  const myPower =
    byId?.[prospect.id]?.overall ??
    overallRankScore(prospect, save.planets ?? []);
  const tech = ensureGuildTech(alliance);
  let score = avg * 0.6 + power * 0.02 + tech.up * 40 + tech.mining * 35;
  if (alliance.factionId === factionOf(prospect)) score *= 1.25;
  if (alliance.factionId === pickFactionForRealm(prospect)) score *= 1.1;
  if (myPower > avg * 2.5 && members.length < 5) score *= 0.4;
  if (members.length >= 5 && members.length <= 25) score *= 1.15;
  return score;
}

export function bestGuildToJoin(
  save: GameSave,
  prospect: Realm,
): Alliance | null {
  const open = ensureAlliances(save).filter((a) => a.joinMode !== "closed");
  if (!open.length) return null;
  // Cap scoring work — dozens of guilds × member scans used to freeze pulses
  const MAX_GUILD_SAMPLE = 10;
  let sample = open;
  if (open.length > MAX_GUILD_SAMPLE) {
    sample = [];
    const used = new Set<number>();
    while (sample.length < MAX_GUILD_SAMPLE) {
      const i = Math.floor(Math.random() * open.length);
      if (used.has(i)) continue;
      used.add(i);
      sample.push(open[i]!);
    }
  }
  let best: Alliance | null = null;
  let bestScore = 0;
  for (const a of sample) {
    const score = guildAttractiveness(save, a, prospect);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}
