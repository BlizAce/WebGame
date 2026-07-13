import type { GameSave, GuildWar, Planet, Realm } from "@/lib/db/schema";
import {
  DEFAULT_TECH,
  EMPTY_MOTHERSHIP,
  DEFAULT_MOTHERSHIP_PARTS,
} from "@/lib/db/schema";
import {
  strikeAction,
  uid,
} from "@/lib/game/economy";
import { starterWeapons } from "@/lib/game/races";
import {
  effectiveDefencePotential,
  removeRealmFromAllClusters,
} from "@/lib/game/fleetClusters";
import {
  allianceMembers,
  getAlliance,
  guildTotalPower,
  leaveAlliance,
} from "@/lib/game/guilds";
import { pushNews } from "@/lib/game/news";
import { createRealm, nextAiName } from "@/lib/db/seed";

export function ensureWars(save: GameSave): GuildWar[] {
  if (!save.wars) save.wars = [];
  return save.wars;
}

export function activeWars(save: GameSave): GuildWar[] {
  return ensureWars(save).filter((w) => w.status === "active");
}

export function warBetween(
  save: GameSave,
  aId: string,
  bId: string,
): GuildWar | undefined {
  return activeWars(save).find(
    (w) =>
      (w.attackerAllianceId === aId && w.defenderAllianceId === bId) ||
      (w.attackerAllianceId === bId && w.defenderAllianceId === aId),
  );
}

export function areGuildsAtWar(
  save: GameSave,
  a: Realm,
  b: Realm,
): boolean {
  if (!a.allianceId || !b.allianceId || a.allianceId === b.allianceId) {
    return false;
  }
  return !!warBetween(save, a.allianceId, b.allianceId);
}

/** Active wars involving this guild. */
export function warsForGuild(save: GameSave, allianceId?: string | null): GuildWar[] {
  if (!allianceId) return [];
  return activeWars(save).filter(
    (w) =>
      w.attackerAllianceId === allianceId ||
      w.defenderAllianceId === allianceId,
  );
}

/** Enemy guild id from a war, relative to your guild. */
export function enemyAllianceId(
  war: GuildWar,
  myAllianceId: string,
): string {
  return war.attackerAllianceId === myAllianceId
    ? war.defenderAllianceId
    : war.attackerAllianceId;
}

export function enemyGuildLabel(war: GuildWar, myAllianceId: string): string {
  if (war.attackerAllianceId === myAllianceId) {
    return `[${war.defenderTag}] ${war.defenderName}`;
  }
  return `[${war.attackerTag}] ${war.attackerName}`;
}

/** Living enemy members for a war (your guild's perspective). */
export function warEnemyMembers(
  save: GameSave,
  war: GuildWar,
  myAllianceId: string,
): Realm[] {
  const enemyId = enemyAllianceId(war, myAllianceId);
  const alliance = getAlliance(save, enemyId);
  if (!alliance) return [];
  return allianceMembers(save, alliance).filter(
    (r) => !r.dead && !r.vacation,
  );
}

export function declareGuildWar(
  save: GameSave,
  declarer: Realm,
  targetAllianceId: string,
): GuildWar {
  ensureWars(save);
  if (!declarer.allianceId) throw new Error("Join a guild first");
  if (declarer.allianceId === targetAllianceId) {
    throw new Error("Cannot declare war on your own guild");
  }
  const attacker = getAlliance(save, declarer.allianceId);
  const defender = getAlliance(save, targetAllianceId);
  if (!attacker || !defender) throw new Error("Guild not found");
  if (attacker.leaderId !== declarer.id) {
    throw new Error("Only the guild leader can declare war");
  }
  if (warBetween(save, attacker.id, defender.id)) {
    throw new Error("War already active between these guilds");
  }

  const war: GuildWar = {
    id: uid("war"),
    attackerAllianceId: attacker.id,
    defenderAllianceId: defender.id,
    attackerTag: attacker.tag,
    defenderTag: defender.tag,
    attackerName: attacker.name,
    defenderName: defender.name,
    status: "active",
    declaredAt: Date.now(),
    declaredById: declarer.id,
    declaredByName: declarer.name,
    killsAttacker: 0,
    killsDefender: 0,
  };
  save.wars.unshift(war);
  save.wars = save.wars.slice(0, 80);

  const msg = `WAR DECLARED — [${attacker.tag}] ${attacker.name} vs [${defender.tag}] ${defender.name} (by ${declarer.name})`;
  pushNews(save, "war", msg);
  attacker.news.unshift(msg);
  defender.news.unshift(msg);
  attacker.news = attacker.news.slice(0, 40);
  defender.news = defender.news.slice(0, 40);
  return war;
}

export function endGuildWar(save: GameSave, warId: string, reason?: string): void {
  const war = ensureWars(save).find((w) => w.id === warId);
  if (!war || war.status !== "active") return;
  war.status = "ended";
  war.endedAt = Date.now();
  const text =
    reason ??
    `War ended — [${war.attackerTag}] vs [${war.defenderTag}] (kills ${war.killsAttacker}:${war.killsDefender})`;
  pushNews(save, "war", text);
  const attacker = getAlliance(save, war.attackerAllianceId);
  const defender = getAlliance(save, war.defenderAllianceId);
  if (attacker) {
    attacker.news.unshift(text);
    attacker.news = attacker.news.slice(0, 40);
  }
  if (defender) {
    defender.news.unshift(text);
    defender.news = defender.news.slice(0, 40);
  }
}

/**
 * Either guild's leader may sue for peace and end an active war.
 */
export function endGuildWarByLeader(
  save: GameSave,
  leader: Realm,
  warId: string,
): GuildWar {
  ensureWars(save);
  if (!leader.allianceId) throw new Error("Join a guild first");
  const war = ensureWars(save).find((w) => w.id === warId);
  if (!war || war.status !== "active") throw new Error("War not found");
  if (
    war.attackerAllianceId !== leader.allianceId &&
    war.defenderAllianceId !== leader.allianceId
  ) {
    throw new Error("Your guild is not in this war");
  }
  const alliance = getAlliance(save, leader.allianceId);
  if (!alliance || alliance.leaderId !== leader.id) {
    throw new Error("Only the guild leader can end a war");
  }
  const tag = alliance.tag;
  endGuildWar(
    save,
    warId,
    `[${tag}] sued for peace — war ended vs [${war.attackerAllianceId === leader.allianceId ? war.defenderTag : war.attackerTag}] (kills ${war.killsAttacker}:${war.killsDefender})`,
  );
  return war;
}

/**
 * Annihilate a realm. AI leave a dead shell and a fresh idle replacement is spawned.
 * Player realms are soft-wiped but remain playable (not permanently deleted).
 */
export function destroyRealm(
  save: GameSave,
  victim: Realm,
  destroyer: Realm,
  opts?: { warId?: string },
): { replacementId?: string } {
  if (victim.dead) return {};

  const victimName = victim.name;
  const destroyerName = destroyer.name;

  // Leave guild first (dissolves guild if this was the last living member)
  removeRealmFromAllClusters(save, victim.id, { silent: true });
  if (victim.allianceId) {
    try {
      leaveAlliance(save, victim, { silent: true });
    } catch {
      const alliance = getAlliance(save, victim.allianceId);
      if (alliance) {
        alliance.memberIds = alliance.memberIds.filter((id) => id !== victim.id);
      }
      victim.allianceId = undefined;
    }
  }

  // Free planets
  for (const p of save.planets ?? []) {
    if (p.ownerId === victim.id) p.ownerId = null;
  }

  if (opts?.warId) {
    const war = ensureWars(save).find((w) => w.id === opts.warId);
    if (war && war.status === "active") {
      if (destroyer.allianceId === war.attackerAllianceId) war.killsAttacker += 1;
      if (destroyer.allianceId === war.defenderAllianceId) war.killsDefender += 1;
    }
  }

  pushNews(
    save,
    "destruction",
    `ANNIHILATED — ${victimName} destroyed by ${destroyerName}`,
  );

  if (victim.isPlayer) {
    // Soft wipe — player keeps the account but is gutted
    victim.naquadah = 200;
    victim.bankNaquadah = 0;
    victim.units = {
      untrained: 20,
      miners: 0,
      offence: 0,
      defence: 0,
      covert: 0,
      antiCovert: 0,
    };
    victim.weapons = starterWeapons(victim.race).map((w) => ({
      ...w,
      quantity: w.techReq <= 1 && w.power <= 10 ? 2 : 0,
    }));
    victim.mothership = {
      ...EMPTY_MOTHERSHIP,
      parts: { ...DEFAULT_MOTHERSHIP_PARTS },
    };
    victim.tech = { ...DEFAULT_TECH };
    victim.techLevel = 1;
    victim.unitProductionLevel = Math.max(1, victim.unitProductionLevel);
    victim.defenceAlert = 0;
    victim.attackFatigue = 0;
    pushNews(
      save,
      "destruction",
      `${victimName} realm shattered — emergency reconstitution protocols engaged`,
    );
    return {};
  }

  // Mark AI as dead husk — never updates again
  victim.dead = true;
  victim.destroyedAt = Date.now();
  victim.destroyedByName = destroyerName;
  victim.vacation = true;
  victim.naquadah = 0;
  victim.bankNaquadah = 0;
  victim.attackTurns = 0;
  victim.covertCapacity = 0;
  victim.units = {
    untrained: 0,
    miners: 0,
    offence: 0,
    defence: 0,
    covert: 0,
    antiCovert: 0,
  };
  victim.weapons = victim.weapons.map((w) => ({ ...w, quantity: 0 }));
  victim.mothership = {
    ...EMPTY_MOTHERSHIP,
    parts: { ...DEFAULT_MOTHERSHIP_PARTS },
  };
  victim.name = `† ${victimName}`;

  // Dead husk sits idle; spawn a fresh living AI with a unique name.
  const replacement = createRealm(
    nextAiName(save),
    victim.race,
    false,
    0.55 + Math.random() * 0.4,
  );
  save.realms.push(replacement);
  pushNews(
    save,
    "universe",
    `New signal — ${replacement.name} emerges from the gate fog`,
  );

  return { replacementId: replacement.id };
}

/** Minimum strike/defence ratio to attempt eradication (1× tier = 10× power). */
export const ERADICATION_RATIO_PER_TIER = 10;
/** Chance per 10× power tier (10× → 5%, 20× → 10%, …). */
export const ERADICATION_CHANCE_PER_TIER = 0.05;
export const ERADICATION_CHANCE_CAP = 0.95;
/** Attack turns spent on a dedicated eradication attempt. */
export const ERADICATION_TURN_COST = 10;

/** Strike ÷ defence power ratio for eradication math (cluster-aware). */
export function eradicationPowerRatio(
  attacker: Realm,
  defender: Realm,
  planets: Planet[] = [],
  save?: GameSave,
): number {
  const atk = strikeAction(attacker, planets);
  const def = effectiveDefencePotential(defender, planets, save);
  return atk / Math.max(1, def);
}

/** How many full 10× tiers (0 if under 10×). */
export function eradicationTier(ratio: number): number {
  return Math.max(0, Math.floor(ratio / ERADICATION_RATIO_PER_TIER));
}

/**
 * Kill-move chance: 5% per full 10× power over the target.
 * 10× → 5%, 20× → 10%, 30× → 15%, … capped at 95%.
 */
export function eradicationChance(ratio: number): number {
  const tiers = eradicationTier(ratio);
  if (tiers < 1) return 0;
  return Math.min(
    ERADICATION_CHANCE_CAP,
    tiers * ERADICATION_CHANCE_PER_TIER,
  );
}

export function canAttemptEradication(
  attacker: Realm,
  defender: Realm,
  planets: Planet[] = [],
  save?: GameSave,
): boolean {
  if (attacker.dead || defender.dead || defender.vacation) return false;
  if (attacker.id === defender.id) return false;
  return (
    eradicationChance(
      eradicationPowerRatio(attacker, defender, planets, save),
    ) > 0
  );
}

/** AI leaders may end a war they're losing badly or that has gone long enough. */
export function tryAiEndWar(save: GameSave, ai: Realm): boolean {
  if (!ai.allianceId || ai.dead) return false;
  const alliance = getAlliance(save, ai.allianceId);
  if (!alliance || alliance.leaderId !== ai.id) return false;

  const myWars = warsForGuild(save, ai.allianceId);
  if (!myWars.length) return false;

  for (const war of myWars) {
    const ageH = (Date.now() - war.declaredAt) / (1000 * 60 * 60);
    const myKills =
      war.attackerAllianceId === ai.allianceId
        ? war.killsAttacker
        : war.killsDefender;
    const theirKills =
      war.attackerAllianceId === ai.allianceId
        ? war.killsDefender
        : war.killsAttacker;
    const enemyAlive = warEnemyMembers(save, war, ai.allianceId).length;
    const myAlive = allianceMembers(save, alliance).filter(
      (r) => !r.dead && !r.vacation,
    ).length;

    // Peace if crushed, or war dragged on with few kills left to take
    const losingBadly = theirKills >= myKills + 3 && myAlive < enemyAlive;
    const stalemate = ageH > 18 && enemyAlive === 0;
    const exhausted = ageH > 36 && Math.random() < 0.25;
    if (losingBadly && Math.random() < 0.4) {
      try {
        endGuildWarByLeader(save, ai, war.id);
        return true;
      } catch {
        /* ignore */
      }
    }
    if ((stalemate || exhausted) && Math.random() < 0.35) {
      try {
        endGuildWarByLeader(save, ai, war.id);
        return true;
      } catch {
        /* ignore */
      }
    }
  }
  return false;
}

export function tryAiDeclareWar(save: GameSave, ai: Realm): boolean {
  if (!ai.allianceId || ai.dead) return false;
  const alliance = getAlliance(save, ai.allianceId);
  if (!alliance || alliance.leaderId !== ai.id) return false;
  if (Math.random() > 0.08) return false;

  const rivals = (save.alliances ?? []).filter(
    (a) => a.id !== alliance.id && a.memberIds.length >= 2,
  );
  if (!rivals.length) return false;

  const scored = rivals
    .map((a) => {
      const power = guildTotalPower(save, a);
      const myPower = guildTotalPower(save, alliance);
      return { a, power, ratio: myPower / Math.max(1, power) };
    })
    .filter((x) => x.ratio > 0.85 && !warBetween(save, alliance.id, x.a.id))
    .sort((a, b) => b.ratio - a.ratio);

  if (!scored.length) return false;
  try {
    declareGuildWar(save, ai, scored[0]!.a.id);
    return true;
  } catch {
    return false;
  }
}
