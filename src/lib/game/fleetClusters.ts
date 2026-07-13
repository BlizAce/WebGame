import type { FleetCluster, GameSave, Planet, Realm } from "@/lib/db/schema";
import { defenceAction, uid } from "@/lib/game/economy";
import { getAlliance, getRealmIndex } from "@/lib/game/guilds";
import { pushNews } from "@/lib/game/news";

export const FLEET_CLUSTER_MAX = 10;

export function ensureFleetClusters(save: GameSave): FleetCluster[] {
  if (!save.fleetClusters) save.fleetClusters = [];
  return save.fleetClusters;
}

export function getCluster(save: GameSave, clusterId?: string | null): FleetCluster | undefined {
  if (!clusterId) return undefined;
  return ensureFleetClusters(save).find((c) => c.id === clusterId);
}

export function getClusterForRealm(
  save: GameSave,
  realmId: string,
): FleetCluster | undefined {
  return ensureFleetClusters(save).find((c) => c.memberIds.includes(realmId));
}

export function getClusterForGuild(
  save: GameSave,
  allianceId: string,
): FleetCluster | undefined {
  return ensureFleetClusters(save).find((c) => c.allianceId === allianceId);
}

export function clusterLivingMembers(
  save: GameSave,
  cluster: FleetCluster,
): Realm[] {
  const byId = getRealmIndex(save);
  const out: Realm[] = [];
  for (const id of cluster.memberIds) {
    const r = byId.get(id);
    if (r && !r.dead && !r.vacation) out.push(r);
  }
  return out;
}

/**
 * Defence power facing an attacker when the target is clustered:
 * sum of living cluster members' defence. Solo if no cluster.
 */
export function effectiveDefencePotential(
  defender: Realm,
  planets: Planet[] = [],
  save?: GameSave,
): number {
  if (!save) return defenceAction(defender, planets);
  const cluster = getClusterForRealm(save, defender.id);
  if (!cluster) return defenceAction(defender, planets);
  const living = clusterLivingMembers(save, cluster);
  if (living.length <= 1) return defenceAction(defender, planets);
  let total = 0;
  for (const m of living) {
    total += defenceAction(m, planets);
  }
  return Math.max(1, total);
}

export function clusterDefenceBreakdown(
  save: GameSave,
  defender: Realm,
  planets: Planet[] = [],
): { cluster: FleetCluster | null; members: Realm[]; total: number } {
  const cluster = getClusterForRealm(save, defender.id) ?? null;
  if (!cluster) {
    return {
      cluster: null,
      members: [defender],
      total: defenceAction(defender, planets),
    };
  }
  const members = clusterLivingMembers(save, cluster);
  const list = members.length ? members : [defender];
  let total = 0;
  for (const m of list) total += defenceAction(m, planets);
  return { cluster, members: list, total: Math.max(1, total) };
}

function assertLivingGuildMember(realm: Realm): void {
  if (realm.dead) throw new Error("Dead realms cannot use fleet clusters");
  if (realm.vacation) throw new Error("Vacation mode — leave vacation first");
  if (!realm.allianceId) throw new Error("Join a guild before clustering");
}

/** Start a fleet cluster for your guild (one cluster per guild). */
export function startFleetCluster(save: GameSave, leader: Realm): FleetCluster {
  ensureFleetClusters(save);
  assertLivingGuildMember(leader);
  if (getClusterForRealm(save, leader.id)) {
    throw new Error("Already in a fleet cluster");
  }
  const existing = getClusterForGuild(save, leader.allianceId!);
  if (existing) {
    throw new Error("Your guild already has a fleet cluster — join it instead");
  }
  const alliance = getAlliance(save, leader.allianceId);
  if (!alliance) throw new Error("Guild not found");

  const clusters = ensureFleetClusters(save);
  const cluster: FleetCluster = {
    id: uid("cluster"),
    allianceId: alliance.id,
    leaderId: leader.id,
    memberIds: [leader.id],
    createdAt: Date.now(),
  };
  clusters.push(cluster);
  alliance.news.unshift(
    `${leader.name} formed a fleet cluster (max ${FLEET_CLUSTER_MAX})`,
  );
  alliance.news = alliance.news.slice(0, 40);
  pushNews(
    save,
    "guild",
    `Fleet cluster formed — [${alliance.tag}] ${leader.name} is standing by`,
  );
  return cluster;
}

export function joinFleetCluster(
  save: GameSave,
  realm: Realm,
  clusterId?: string,
): FleetCluster {
  ensureFleetClusters(save);
  assertLivingGuildMember(realm);
  if (getClusterForRealm(save, realm.id)) {
    throw new Error("Already in a fleet cluster");
  }

  const cluster =
    (clusterId ? getCluster(save, clusterId) : null) ??
    getClusterForGuild(save, realm.allianceId!);
  if (!cluster) throw new Error("No fleet cluster to join");
  if (cluster.allianceId !== realm.allianceId) {
    throw new Error("Can only join your guild's fleet cluster");
  }
  if (cluster.memberIds.length >= FLEET_CLUSTER_MAX) {
    throw new Error(`Fleet cluster is full (${FLEET_CLUSTER_MAX} max)`);
  }

  cluster.memberIds.push(realm.id);
  const alliance = getAlliance(save, cluster.allianceId);
  if (alliance) {
    alliance.news.unshift(
      `${realm.name} joined the fleet cluster (${cluster.memberIds.length}/${FLEET_CLUSTER_MAX})`,
    );
    alliance.news = alliance.news.slice(0, 40);
  }
  return cluster;
}

export function leaveFleetCluster(save: GameSave, realm: Realm): void {
  const cluster = getClusterForRealm(save, realm.id);
  if (!cluster) throw new Error("Not in a fleet cluster");
  removeMemberFromCluster(save, cluster, realm.id, { silent: false });
}

export function kickFromFleetCluster(
  save: GameSave,
  leader: Realm,
  targetId: string,
): void {
  const cluster = getClusterForRealm(save, leader.id);
  if (!cluster) throw new Error("Not in a fleet cluster");
  if (cluster.leaderId !== leader.id) {
    throw new Error("Only the cluster leader can kick members");
  }
  if (targetId === leader.id) throw new Error("Cannot kick yourself — leave or dissolve");
  if (!cluster.memberIds.includes(targetId)) {
    throw new Error("That realm is not in your cluster");
  }
  removeMemberFromCluster(save, cluster, targetId, { silent: false });
}

export function dissolveFleetCluster(save: GameSave, leader: Realm): void {
  const cluster = getClusterForRealm(save, leader.id);
  if (!cluster) throw new Error("Not in a fleet cluster");
  if (cluster.leaderId !== leader.id) {
    throw new Error("Only the cluster leader can dissolve it");
  }
  dissolveCluster(save, cluster, { reason: `${leader.name} dissolved the fleet cluster` });
}

/** Drop a realm from any cluster (guild leave / death). */
export function removeRealmFromAllClusters(
  save: GameSave,
  realmId: string,
  opts?: { silent?: boolean },
): void {
  const cluster = getClusterForRealm(save, realmId);
  if (!cluster) return;
  removeMemberFromCluster(save, cluster, realmId, {
    silent: opts?.silent ?? true,
  });
}

function removeMemberFromCluster(
  save: GameSave,
  cluster: FleetCluster,
  realmId: string,
  opts?: { silent?: boolean },
): void {
  cluster.memberIds = cluster.memberIds.filter((id) => id !== realmId);
  const byId = getRealmIndex(save);
  const living = cluster.memberIds.filter((id) => {
    const r = byId.get(id);
    return r && !r.dead;
  });
  cluster.memberIds = living;

  if (cluster.memberIds.length === 0) {
    dissolveCluster(save, cluster, {
      reason: opts?.silent ? undefined : "Fleet cluster disbanded",
      silent: opts?.silent,
    });
    return;
  }

  if (cluster.leaderId === realmId || !cluster.memberIds.includes(cluster.leaderId)) {
    // Promote highest overall-score living member (prefer cached)
    const byScore = [...clusterLivingMembers(save, cluster)].sort((a, b) => {
      const sa = save.rankingsCache?.byId[a.id]?.overall ?? 0;
      const sb = save.rankingsCache?.byId[b.id]?.overall ?? 0;
      return sb - sa;
    });
    cluster.leaderId = byScore[0]?.id ?? cluster.memberIds[0]!;
    if (!opts?.silent) {
      const alliance = getAlliance(save, cluster.allianceId);
      const name = byId.get(cluster.leaderId)?.name ?? "?";
      alliance?.news.unshift(`${name} is the new fleet cluster leader`);
      if (alliance) alliance.news = alliance.news.slice(0, 40);
    }
  }

  if (!opts?.silent) {
    const alliance = getAlliance(save, cluster.allianceId);
    const name = byId.get(realmId)?.name ?? "A commander";
    alliance?.news.unshift(`${name} left the fleet cluster`);
    if (alliance) alliance.news = alliance.news.slice(0, 40);
  }
}

function dissolveCluster(
  save: GameSave,
  cluster: FleetCluster,
  opts?: { reason?: string; silent?: boolean },
): void {
  save.fleetClusters = ensureFleetClusters(save).filter((c) => c.id !== cluster.id);
  if (opts?.silent) return;
  const alliance = getAlliance(save, cluster.allianceId);
  if (opts?.reason && alliance) {
    alliance.news.unshift(opts.reason);
    alliance.news = alliance.news.slice(0, 40);
  }
  if (opts?.reason) {
    pushNews(save, "guild", opts.reason);
  }
}

/** Prune dead/left-guild members; dissolve empty or orphaned clusters. */
export function pruneFleetClusters(save: GameSave): number {
  const clusters = ensureFleetClusters(save);
  let removed = 0;
  for (const cluster of [...clusters]) {
    const before = cluster.memberIds.length;
    const byId = getRealmIndex(save);
    cluster.memberIds = cluster.memberIds.filter((id: string) => {
      const r = byId.get(id);
      if (!r || r.dead) return false;
      if (r.allianceId !== cluster.allianceId) return false;
      return true;
    });
    if (cluster.memberIds.length !== before) removed += 1;

    if (!getAlliance(save, cluster.allianceId) || cluster.memberIds.length === 0) {
      dissolveCluster(save, cluster, { silent: true });
      removed += 1;
      continue;
    }
    if (!cluster.memberIds.includes(cluster.leaderId)) {
      cluster.leaderId = cluster.memberIds[0]!;
    }
  }
  return removed;
}
