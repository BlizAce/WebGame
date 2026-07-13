import type { GameSave, Realm } from "@/lib/db/schema";
import { EMPTY_MOTHERSHIP, DEFAULT_MOTHERSHIP_PARTS } from "@/lib/db/schema";

/** Soft caps applied on every persist. */
export const COMPACT = {
  attackLogs: 180,
  playerAttackLogs: 80,
  intelLogs: 80,
  forumPosts: 120,
  mailThreads: 200,
  mailMessages: 80,
  news: 60,
  marketTrades: 40,
  priceSnapshots: 72, // ~6h at 5min
  wars: 40,
  contracts: 60,
  mindMemories: 12,
  mindRecentActions: 16,
  mindGoals: 4,
  mindPlanSteps: 4,
  personaChars: 280,
  /** ~1000 tokens — do not shrink souls hard on persist */
  soulChars: 4000,
  deadAiKeep: 40,
  allianceNews: 8,
} as const;

type CompactCaps = {
  attackLogs: number;
  playerAttackLogs: number;
  intelLogs: number;
  forumPosts: number;
  mailThreads: number;
  mailMessages: number;
  news: number;
  marketTrades: number;
  priceSnapshots: number;
  wars: number;
  contracts: number;
  mindMemories: number;
  mindRecentActions: number;
  mindGoals: number;
  mindPlanSteps: number;
  personaChars: number;
  soulChars: number;
  deadAiKeep: number;
  allianceNews: number;
};

/**
 * Shrink a save in-place so it fits browser storage.
 * Safe to call often — drops caches, stale minds, empty weapon rows, old logs.
 */
export function compactSave(save: GameSave, hard = false): GameSave {
  const caps: CompactCaps = hard
    ? {
        ...COMPACT,
        attackLogs: 80,
        playerAttackLogs: 40,
        intelLogs: 40,
        forumPosts: 60,
        mailThreads: 80,
        mailMessages: 40,
        news: 30,
        marketTrades: 20,
        priceSnapshots: 36,
        mindMemories: 4,
        mindRecentActions: 8,
        mindPlanSteps: 2,
        deadAiKeep: 15,
        soulChars: 4000,
      }
    : { ...COMPACT };

  // Rankings snapshot is rebuilt in-session — drop from disk payload
  delete save.rankingsCache;
  save.lastRankingsRefreshAt = 0;

  // --- Logs ---
  if (!save.logs) save.logs = { attacks: [], intelligence: [] };
  const playerId = save.playerId;
  const attacks = save.logs.attacks ?? [];
  if (attacks.length > caps.attackLogs) {
    const playerRelated = attacks.filter(
      (l) =>
        l.attackerId === playerId ||
        l.defenderId === playerId ||
        (l.kind === "planet" && l.attackerId === playerId),
    );
    const other = attacks.filter(
      (l) =>
        l.attackerId !== playerId &&
        l.defenderId !== playerId &&
        !(l.kind === "planet" && l.attackerId === playerId),
    );
    const keepP = playerRelated.slice(0, caps.playerAttackLogs);
    const room = Math.max(0, caps.attackLogs - keepP.length);
    save.logs.attacks = [...keepP, ...other.slice(0, room)];
  }
  save.logs.intelligence = (save.logs.intelligence ?? []).slice(
    0,
    caps.intelLogs,
  );

  // --- News / forum / wars / contracts ---
  if (save.news) save.news = save.news.slice(0, caps.news);
  if (save.forum?.posts) {
    save.forum.posts = save.forum.posts.slice(0, caps.forumPosts);
  }
  if (save.mail?.threads) {
    save.mail.threads = save.mail.threads
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, caps.mailThreads)
      .map((t) => ({
        ...t,
        messages: (t.messages ?? []).slice(-caps.mailMessages),
      }));
  }
  if (save.wars) save.wars = save.wars.slice(0, caps.wars);
  if (save.contracts) save.contracts = save.contracts.slice(0, caps.contracts);

  // --- Market ---
  if (save.market) {
    save.market.trades = (save.market.trades ?? []).slice(0, caps.marketTrades);
    save.market.priceHistory = (save.market.priceHistory ?? []).slice(
      -caps.priceSnapshots,
    );
  }

  // --- Alliances ---
  if (save.alliances) {
    for (const a of save.alliances) {
      if (a.news) a.news = a.news.slice(0, caps.allianceNews);
    }
  }

  // --- Realms ---
  const livingAi: Realm[] = [];
  const deadAi: Realm[] = [];
  const kept: Realm[] = [];

  for (const r of save.realms) {
    if (r.isPlayer) {
      compactRealm(r, caps, true);
      kept.push(r);
      continue;
    }
    if (r.dead) {
      deadAi.push(r);
    } else {
      livingAi.push(r);
    }
  }

  // Keep newest dead husks only; strip them to a stub
  deadAi.sort((a, b) => (b.destroyedAt ?? 0) - (a.destroyedAt ?? 0));
  for (const r of deadAi.slice(0, caps.deadAiKeep)) {
    kept.push(minifyDeadRealm(r));
  }
  for (const r of livingAi) {
    compactRealm(r, caps, false);
    kept.push(r);
  }

  save.realms = kept;
  return save;
}

function compactRealm(
  r: Realm,
  caps: CompactCaps,
  isPlayer: boolean,
): void {
  // Drop empty weapon stacks on AI (catalog rehydrates on buy)
  if (!isPlayer && r.weapons?.length) {
    r.weapons = r.weapons.filter((w) => w.quantity > 0);
  }

  if (r.mind) {
    if (r.dead) {
      delete r.mind;
      return;
    }
    r.mind.persona = (r.mind.persona ?? "").slice(0, caps.personaChars);
    r.mind.goals = (r.mind.goals ?? []).slice(0, caps.mindGoals);
    r.mind.memories = (r.mind.memories ?? []).slice(0, caps.mindMemories);
    r.mind.recentActions = (r.mind.recentActions ?? []).slice(
      0,
      caps.mindRecentActions,
    );
    if (r.mind.soul) {
      r.mind.soul = r.mind.soul.slice(0, caps.soulChars);
    }
    r.mind.plan = (r.mind.plan ?? [])
      .filter((s) => !s.done)
      .slice(0, caps.mindPlanSteps)
      .map((s) => ({
        action: s.action,
        args: s.args,
        note: s.note ? String(s.note).slice(0, 80) : undefined,
      }));
    if (r.mind.planSummary) {
      r.mind.planSummary = r.mind.planSummary.slice(0, 120);
    }
    // Drop virgin minds that never thought — regenerate from seed
    if (
      !isPlayer &&
      !r.mind.thinkCount &&
      !r.mind.lastThinkAt &&
      !r.mind.soul &&
      !r.mind.plan.length &&
      !r.mind.memories.length &&
      !(r.mind.recentActions?.length)
    ) {
      delete r.mind;
    }
  }
}

function minifyDeadRealm(r: Realm): Realm {
  return {
    id: r.id,
    name: r.name,
    race: r.race,
    isPlayer: false,
    naquadah: 0,
    bankNaquadah: 0,
    bankLevel: 1,
    attackTurns: 0,
    restedAttackTurns: 0,
    covertCapacity: 0,
    unitProductionLevel: 1,
    spyLevel: 1,
    antiSpyLevel: 1,
    techLevel: 1,
    tech: {
      general: 1,
      mining: 1,
      offence: 1,
      defence: 1,
      covert: 1,
      equipment: 1,
    },
    units: {
      untrained: 0,
      miners: 0,
      offence: 0,
      defence: 0,
      covert: 0,
      antiCovert: 0,
    },
    weapons: [],
    mothership: {
      ...EMPTY_MOTHERSHIP,
      parts: { ...DEFAULT_MOTHERSHIP_PARTS },
    },
    defenceAlert: 0,
    attackFatigue: 0,
    vacation: true,
    dead: true,
    destroyedAt: r.destroyedAt,
    destroyedByName: r.destroyedByName,
    gloryReputation: 0,
    ascensionLevel: 0,
    ascensionPoints: 0,
    factionId: "unaligned",
  };
}
