import type {
  GameSave,
  GuildRankSnapshot,
  Planet,
  RankingsCache,
  Realm,
  RealmRankSnapshot,
} from "@/lib/db/schema";
import {
  antiCovertAction,
  covertAction,
  defenceAction,
  mothershipAction,
  overallRankScore,
  strikeAction,
} from "@/lib/game/economy";
import {
  allianceMembers,
  ensureAlliances,
  ensureGuildTech,
  pruneEmptyGuilds,
} from "@/lib/game/guilds";

export type RankCategory =
  | "overall"
  | "strike"
  | "defence"
  | "covert"
  | "antiCovert"
  | "mothership"
  | "glory";

export interface RankRow {
  realm: Realm;
  rank: number;
  overall: number;
  strike: number;
  defence: number;
  covert: number;
  antiCovert: number;
  mothership: number;
  gloryReputation: number;
  ascensionLevel: number;
  ascensionPoints: number;
  categoryScore: number;
}

const SCORE_CHUNK = 400;
const DEFAULT_REFRESH_MINUTES = 60;

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function planetCountsByOwner(planets: Planet[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of planets) {
    if (!p.ownerId) continue;
    m.set(p.ownerId, (m.get(p.ownerId) ?? 0) + 1);
  }
  return m;
}

function scoreRealm(
  realm: Realm,
  planets: Planet[],
  planetCount: number,
): Omit<RealmRankSnapshot, "overallRank" | "gloryRank"> {
  const opts = { planetCount };
  const strike = strikeAction(realm, planets, 1, opts);
  const defence = defenceAction(realm, planets, 1, opts);
  const covert = covertAction(realm);
  const antiCovert = antiCovertAction(realm);
  const mothership = mothershipAction(realm);
  return {
    overall: strike + defence + covert + antiCovert + mothership,
    strike,
    defence,
    covert,
    antiCovert,
    mothership,
  };
}

function sortIdsBy(
  ids: string[],
  scoreOf: (id: string) => number,
  nameOf: (id: string) => string,
): string[] {
  return [...ids].sort((a, b) => {
    const sb = scoreOf(b);
    const sa = scoreOf(a);
    if (sb !== sa) return sb - sa;
    return nameOf(a).localeCompare(nameOf(b));
  });
}

function buildGuildSnapshots(
  save: GameSave,
  byId: Record<string, RealmRankSnapshot>,
): GuildRankSnapshot[] {
  pruneEmptyGuilds(save);
  const alliances = ensureAlliances(save);
  const rows: GuildRankSnapshot[] = [];
  for (const alliance of alliances) {
    const members = allianceMembers(save, alliance);
    let power = 0;
    for (const m of members) {
      power += byId[m.id]?.overall ?? 0;
    }
    const tech = ensureGuildTech(alliance);
    const leader = save.realms.find((r) => r.id === alliance.leaderId);
    rows.push({
      allianceId: alliance.id,
      rank: 0,
      power,
      members: members.length,
      avgPower: members.length ? Math.floor(power / members.length) : 0,
      techUp: tech.up,
      techMining: tech.mining,
      leaderName: leader?.name ?? "?",
    });
  }
  rows.sort((a, b) => {
    if (b.power !== a.power) return b.power - a.power;
    return a.allianceId.localeCompare(b.allianceId);
  });
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  return rows;
}

/**
 * Rebuild the rankings snapshot. Prefer the async chunked variant on the UI path.
 */
export function refreshRankingsCache(save: GameSave, now = Date.now()): RankingsCache {
  const planets = save.planets ?? [];
  const counts = planetCountsByOwner(planets);
  const byId: Record<string, RealmRankSnapshot> = {};
  const ids: string[] = [];
  let livingCount = 0;

  for (const realm of save.realms) {
    ids.push(realm.id);
    if (!realm.dead) livingCount += 1;
    const scored = scoreRealm(realm, planets, counts.get(realm.id) ?? 0);
    byId[realm.id] = { ...scored, overallRank: 0, gloryRank: 0 };
  }

  const nameById = new Map(save.realms.map((r) => [r.id, r.name] as const));
  const gloryById = new Map(
    save.realms.map((r) => [r.id, r.gloryReputation ?? 0] as const),
  );
  const nameOf = (id: string) => nameById.get(id) ?? id;

  const order = {
    overall: sortIdsBy(ids, (id) => byId[id]!.overall, nameOf),
    strike: sortIdsBy(ids, (id) => byId[id]!.strike, nameOf),
    defence: sortIdsBy(ids, (id) => byId[id]!.defence, nameOf),
    covert: sortIdsBy(ids, (id) => byId[id]!.covert, nameOf),
    antiCovert: sortIdsBy(ids, (id) => byId[id]!.antiCovert, nameOf),
    mothership: sortIdsBy(ids, (id) => byId[id]!.mothership, nameOf),
    glory: sortIdsBy(ids, (id) => gloryById.get(id) ?? 0, nameOf),
  };

  order.overall.forEach((id, i) => {
    byId[id]!.overallRank = i + 1;
  });
  order.glory.forEach((id, i) => {
    byId[id]!.gloryRank = i + 1;
  });

  const cache: RankingsCache = {
    refreshedAt: now,
    livingCount,
    byId,
    order,
    guilds: buildGuildSnapshots(save, byId),
  };
  save.rankingsCache = cache;
  save.lastRankingsRefreshAt = now;
  return cache;
}

/** Chunked rebuild so the UI stays responsive at 40k scale. */
export async function refreshRankingsCacheAsync(
  save: GameSave,
  now = Date.now(),
): Promise<RankingsCache> {
  const planets = save.planets ?? [];
  const counts = planetCountsByOwner(planets);
  const byId: Record<string, RealmRankSnapshot> = {};
  const ids: string[] = [];
  let livingCount = 0;
  const realms = save.realms;

  for (let i = 0; i < realms.length; i++) {
    const realm = realms[i]!;
    ids.push(realm.id);
    if (!realm.dead) livingCount += 1;
    const scored = scoreRealm(realm, planets, counts.get(realm.id) ?? 0);
    byId[realm.id] = { ...scored, overallRank: 0, gloryRank: 0 };
    if ((i + 1) % SCORE_CHUNK === 0) await yieldToMain();
  }

  const nameById = new Map(realms.map((r) => [r.id, r.name] as const));
  const gloryById = new Map(
    realms.map((r) => [r.id, r.gloryReputation ?? 0] as const),
  );
  const nameOf = (id: string) => nameById.get(id) ?? id;

  await yieldToMain();
  const order = {
    overall: sortIdsBy(ids, (id) => byId[id]!.overall, nameOf),
    strike: sortIdsBy(ids, (id) => byId[id]!.strike, nameOf),
    defence: sortIdsBy(ids, (id) => byId[id]!.defence, nameOf),
    covert: sortIdsBy(ids, (id) => byId[id]!.covert, nameOf),
    antiCovert: sortIdsBy(ids, (id) => byId[id]!.antiCovert, nameOf),
    mothership: sortIdsBy(ids, (id) => byId[id]!.mothership, nameOf),
    glory: sortIdsBy(ids, (id) => gloryById.get(id) ?? 0, nameOf),
  };

  order.overall.forEach((id, i) => {
    byId[id]!.overallRank = i + 1;
  });
  order.glory.forEach((id, i) => {
    byId[id]!.gloryRank = i + 1;
  });

  await yieldToMain();
  const cache: RankingsCache = {
    refreshedAt: now,
    livingCount,
    byId,
    order,
    guilds: buildGuildSnapshots(save, byId),
  };
  save.rankingsCache = cache;
  save.lastRankingsRefreshAt = now;
  return cache;
}

export function rankingsRefreshIntervalMs(save: GameSave): number {
  const mins = Math.max(
    1,
    save.settings.rankingsRefreshMinutes ?? DEFAULT_REFRESH_MINUTES,
  );
  return mins * 60 * 1000;
}

export function msUntilRankingsRefresh(save: GameSave, now = Date.now()): number {
  const last = save.lastRankingsRefreshAt ?? 0;
  if (!save.rankingsCache || !last) return 0;
  return Math.max(0, last + rankingsRefreshIntervalMs(save) - now);
}

export function rankingsCacheStale(save: GameSave, now = Date.now()): boolean {
  if (!save.rankingsCache) return true;
  return msUntilRankingsRefresh(save, now) <= 0;
}

/** Ensure a cache exists (sync). Use sparingly — prefer async refresh. */
export function ensureRankingsCache(save: GameSave): RankingsCache {
  if (save.rankingsCache) return save.rankingsCache;
  return refreshRankingsCache(save);
}

export function getRealmRankSnapshot(
  save: GameSave,
  realmId: string,
): RealmRankSnapshot | null {
  return save.rankingsCache?.byId[realmId] ?? null;
}

export function cachedOverallScore(save: GameSave, realmId: string): number {
  const snap = getRealmRankSnapshot(save, realmId);
  if (snap) return snap.overall;
  const realm = save.realms.find((r) => r.id === realmId);
  if (!realm) return 0;
  return overallRankScore(realm, save.planets ?? []);
}

export function overallRankOf(save: GameSave, realmId: string): number {
  const snap = getRealmRankSnapshot(save, realmId);
  if (snap) return snap.overallRank;
  return save.realms.length;
}

/**
 * How far below your rank (worse standing) you may still attack, as a
 * fraction of the living ladder. Rank 1 = best; higher numbers are weaker.
 * 0.10 with 1000 living → #1 can attack down to #100.
 */
export const ATTACK_RANK_BELOW_FRACTION = 0.1;

/** Living realms used for the attack-range band (prefer rankings cache). */
export function attackRankPoolSize(save: GameSave): number {
  const cached = save.rankingsCache?.livingCount;
  if (cached && cached > 0) return cached;
  let n = 0;
  for (const r of save.realms) if (!r.dead) n++;
  return Math.max(1, n);
}

/**
 * Worst (highest) overall rank number you may attack.
 * Band size = floor(living × 10%), so #1 of 1000 reaches #100.
 */
export function maxAttackableRank(
  attackerRank: number,
  livingCount: number,
): number {
  const r = Math.max(1, Math.floor(attackerRank));
  const pool = Math.max(1, Math.floor(livingCount));
  const span = Math.max(1, Math.floor(pool * ATTACK_RANK_BELOW_FRACTION));
  return Math.min(pool, r + span - 1);
}

export function maxAttackableRankFor(
  save: GameSave,
  attackerId: string,
): number {
  return maxAttackableRank(
    overallRankOf(save, attackerId),
    attackRankPoolSize(save),
  );
}

/**
 * True when the defender is too far below the attacker in overall rank
 * (classic farming protection). Better-ranked targets are always allowed.
 */
export function isBelowAttackRankRange(
  save: GameSave,
  attackerId: string,
  defenderId: string,
): boolean {
  const defRank = overallRankOf(save, defenderId);
  return defRank > maxAttackableRankFor(save, attackerId);
}

export function assertAttackRankRange(
  save: GameSave,
  attackerId: string,
  defenderId: string,
): void {
  const atkRank = overallRankOf(save, attackerId);
  const defRank = overallRankOf(save, defenderId);
  const maxRank = maxAttackableRankFor(save, attackerId);
  if (defRank > maxRank) {
    throw new Error(
      `Out of rank range — you are #${atkRank}, can attack down to #${maxRank} (target is #${defRank})`,
    );
  }
}

export function cachedGuildPower(save: GameSave, allianceId: string): number {
  const g = save.rankingsCache?.guilds.find((x) => x.allianceId === allianceId);
  if (g) return g.power;
  return 0;
}

export function cachedGuildRank(
  save: GameSave,
  allianceId: string,
): number | null {
  const g = save.rankingsCache?.guilds.find((x) => x.allianceId === allianceId);
  return g?.rank ?? null;
}

function categoryScoreFromSnap(
  category: RankCategory,
  snap: RealmRankSnapshot,
  glory: number,
): number {
  switch (category) {
    case "strike":
      return snap.strike;
    case "defence":
      return snap.defence;
    case "covert":
      return snap.covert;
    case "antiCovert":
      return snap.antiCovert;
    case "mothership":
      return snap.mothership;
    case "glory":
      return glory;
    case "overall":
    default:
      return snap.overall;
  }
}

/** Leaderboard rows from cache (O(n) assemble, no rescoring). */
export function buildRankings(
  save: GameSave,
  category: RankCategory = "overall",
): RankRow[] {
  const cache = save.rankingsCache;
  if (!cache) return [];

  const order = cache.order[category] ?? cache.order.overall;
  const realmById = new Map(save.realms.map((r) => [r.id, r] as const));
  const rows: RankRow[] = [];

  for (let i = 0; i < order.length; i++) {
    const id = order[i]!;
    const realm = realmById.get(id);
    const snap = cache.byId[id];
    if (!realm || !snap) continue;
    const gloryReputation = realm.gloryReputation ?? 0;
    const categoryScore = categoryScoreFromSnap(
      category,
      snap,
      gloryReputation,
    );
    rows.push({
      realm,
      rank: i + 1,
      overall: snap.overall,
      strike: snap.strike,
      defence: snap.defence,
      covert: snap.covert,
      antiCovert: snap.antiCovert,
      mothership: snap.mothership,
      gloryReputation,
      ascensionLevel: realm.ascensionLevel ?? 0,
      ascensionPoints: realm.ascensionPoints ?? 0,
      categoryScore,
    });
  }
  return rows;
}

/**
 * Classic GateWars G&R tiers, floored for small local populations:
 * - Rank 1 → 10 / turn
 * - ~top 15% (min rank 2) → 5 / turn
 * - ~top 40% (min a few ranks) → 1 / turn
 */
export function gloryPerTurnForRank(rank: number, totalPlayers: number): number {
  if (rank < 1 || totalPlayers < 1) return 0;
  if (rank === 1) return 10;
  const topElite = Math.max(2, Math.ceil(totalPlayers * 0.15));
  const topBand = Math.max(topElite + 1, Math.ceil(totalPlayers * 0.4));
  if (rank <= topElite) return 5;
  if (rank <= topBand) return 1;
  return 0;
}

/**
 * Award G&R from the cached overall order (no rescoring).
 * Falls back to a sync refresh if the cache is missing.
 */
export function awardGloryForTurn(save: GameSave): void {
  // Never sync-rebuild here — that freezes the turn path at 40k scale.
  const cache = save.rankingsCache;
  if (!cache?.order?.overall?.length) return;

  const realmById = new Map(save.realms.map((r) => [r.id, r] as const));
  const living: Realm[] = [];
  for (const id of cache.order.overall) {
    const r = realmById.get(id);
    if (r && !r.dead) living.push(r);
  }
  const total = living.length || cache.livingCount;
  for (let i = 0; i < living.length; i++) {
    const realm = living[i]!;
    if (realm.vacation) continue;
    const gain = gloryPerTurnForRank(i + 1, total);
    if (gain <= 0) continue;
    realm.gloryReputation = (realm.gloryReputation ?? 0) + gain;
  }
}
