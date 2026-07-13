import type {
  ForumChannelKind,
  ForumPost,
  ForumState,
  GameSave,
  Realm,
} from "@/lib/db/schema";
import { DEFAULT_FORUM } from "@/lib/db/schema";
import { warsForGuild, warEnemyMembers } from "@/lib/game/wars";
import {
  defenceAction,
  formatNaq,
  strikeAction,
  uid,
} from "@/lib/game/economy";
import { cachedOverallScore } from "@/lib/game/rankings";
import {
  allianceMembers,
  buildGuildRankings,
  ensureGuildTech,
  getAlliance,
  guildTotalPower,
} from "@/lib/game/guilds";
import {
  chatStyleFor,
  chatStylePrompt,
  ensureMind,
} from "@/lib/game/mind";
import {
  recentAttackLogContext,
  recentNewsContext,
  guildLogContext,
} from "@/lib/game/aiWorldContext";

export const MAX_FORUM_POSTS = 120;
export const MAX_POST_LENGTH = 500;
export const MIN_POST_LENGTH = 1;
/** Min gap between AI forum generation waves (client). */
export const AI_FORUM_COOLDOWN_MS = 45_000;
/** Max AI posts requested per wave. */
export const AI_FORUM_BATCH = 3;

/** True if a post looks like leaked model reasoning / meta (do not feed back to AI). */
export function isContaminatedForumText(body: string): boolean {
  const t = body.trim();
  if (!t) return true;
  if (/thinking process\s*:/i.test(t)) return true;
  if (
    /\b(output only|system (persona )?instructions?|as per the (system|persona)|looking at the log again|this was a previous turn|in the simulation|i should just output|wait, reading it again|the instruction\b|analyze the request)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/^\*wait,/i.test(t) && /log|instruction|simulation/i.test(t)) return true;
  if (t.length > 320 && /instruction|simulation|output only/i.test(t)) {
    return true;
  }
  return false;
}

export function ensureForum(save: GameSave): ForumState {
  if (!save.forum) save.forum = structuredClone(DEFAULT_FORUM);
  if (!save.forum.posts) save.forum.posts = [];
  // Opportunistic cleanup of CoT leaks already in the feed
  const before = save.forum.posts.length;
  save.forum.posts = save.forum.posts.filter(
    (p) => !isContaminatedForumText(p.body),
  );
  if (save.forum.posts.length > MAX_FORUM_POSTS) {
    save.forum.posts = save.forum.posts.slice(0, MAX_FORUM_POSTS);
  }
  if (save.forum.posts.length !== before) {
    // leave lastAiChatAt alone
  }
  return save.forum;
}

export function pruneForum(save: GameSave): void {
  const f = ensureForum(save);
  // Drop leaked CoT / meta posts so they stop poisoning future AI context + UI
  f.posts = f.posts.filter((p) => !isContaminatedForumText(p.body));
  if (f.posts.length > MAX_FORUM_POSTS) {
    f.posts = f.posts.slice(0, MAX_FORUM_POSTS);
  }
}

export function listForumPosts(
  save: GameSave,
  opts: { channel: ForumChannelKind; allianceId?: string | null },
): ForumPost[] {
  const posts = ensureForum(save).posts;
  if (opts.channel === "open") {
    return posts.filter((p) => p.channel === "open");
  }
  if (!opts.allianceId) return [];
  return posts.filter(
    (p) => p.channel === "guild" && p.allianceId === opts.allianceId,
  );
}

/** Strip "Name:" / "Name -" prefixes models love to prepend. */
export function sanitizeForumBody(body: string, authorName?: string): string {
  let text = body.trim();
  if (authorName) {
    const escaped = authorName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`^${escaped}\\s*[:\\-–—]\\s*`, "i"), "");
  }
  text = text.replace(/^["'`]+|["'`]+$/g, "").trim();
  // Drop trailing cut-off mid-thought fragments
  if (/^(let'?s try to|wait[,.]?|hmm[,.]?|okay[,.]?)\s*$/i.test(text)) {
    return "";
  }
  if (isContaminatedForumText(text)) return "";
  // Soft cap — real guild chat is short
  if (text.length > 360) {
    const cut = text.slice(0, 360);
    const lastStop = Math.max(
      cut.lastIndexOf("."),
      cut.lastIndexOf("!"),
      cut.lastIndexOf("?"),
    );
    text = lastStop > 80 ? cut.slice(0, lastStop + 1) : cut;
  }
  return text.slice(0, MAX_POST_LENGTH);
}

export function createForumPost(
  save: GameSave,
  author: Realm,
  opts: {
    channel: ForumChannelKind;
    body: string;
    isAi?: boolean;
  },
): ForumPost {
  ensureForum(save);
  if (author.dead) throw new Error("Destroyed realms cannot post");
  if (author.vacation) throw new Error("Vacation mode — forum locked");

  const body = sanitizeForumBody(opts.body, author.name);
  if (body.length < MIN_POST_LENGTH) throw new Error("Message is empty");

  let allianceId: string | undefined;
  let allianceTag: string | undefined;

  if (opts.channel === "guild") {
    if (!author.allianceId) throw new Error("Join a guild to use guild chat");
    const guild = getAlliance(save, author.allianceId);
    if (!guild) throw new Error("Guild not found");
    allianceId = guild.id;
    allianceTag = guild.tag;
  }

  const post: ForumPost = {
    id: uid("frm"),
    at: Date.now(),
    channel: opts.channel,
    allianceId,
    allianceTag,
    authorId: author.id,
    authorName: author.name,
    isAi: !!opts.isAi || !author.isPlayer,
    body,
  };

  save.forum.posts.unshift(post);
  pruneForum(save);
  return post;
}

/** One-line + multi-line dossier for a commander (stats + their guild). */
export function commanderDossier(
  save: GameSave,
  realm: Realm,
  opts?: { relativeTo?: Realm },
): string {
  const planets = save.planets ?? [];
  const guild = getAlliance(save, realm.allianceId);
  const score = cachedOverallScore(save, realm.id);
  const strike = strikeAction(realm, planets);
  const def = defenceAction(realm, planets);
  const army = realm.units.offence + realm.units.defence;
  const lines = [
    `${realm.name} (${realm.id}) — ${realm.race}${realm.dead ? " [DEAD]" : ""}${realm.isPlayer ? " [PLAYER]" : ""}`,
    `  score=${formatNaq(score)} strike=${formatNaq(strike)} def=${formatNaq(def)} naq=${formatNaq(realm.naquadah)} bank=${formatNaq(realm.bankNaquadah)}`,
    `  units UU=${realm.units.untrained} miners=${realm.units.miners} off=${realm.units.offence} def=${realm.units.defence} cov=${realm.units.covert} army=${army}`,
    `  turns=${Math.floor(realm.attackTurns)} UP=${realm.unitProductionLevel} MS=${realm.mothership?.tier ?? 0}`,
  ];
  if (guild) {
    const power = guildTotalPower(save, guild);
    const tech = ensureGuildTech(guild);
    const members = allianceMembers(save, guild).filter((m) => !m.dead);
    const wars = warsForGuild(save, guild.id);
    lines.push(
      `  guild=[${guild.tag}] ${guild.name} power=${formatNaq(power)} members=${members.length} tech UP=${tech.up}/mine=${tech.mining} leader=${guild.leaderId === realm.id ? "yes" : "no"}`,
    );
    if (wars.length) {
      lines.push(
        `  guild wars: ${wars
          .map((w) =>
            w.attackerAllianceId === guild.id
              ? `vs [${w.defenderTag}] (${w.killsAttacker}:${w.killsDefender})`
              : `vs [${w.attackerTag}] (${w.killsDefender}:${w.killsAttacker})`,
          )
          .join("; ")}`,
      );
    }
  } else {
    lines.push(`  guild=none`);
  }
  if (opts?.relativeTo && opts.relativeTo.id !== realm.id) {
    const myStrike = strikeAction(opts.relativeTo, planets);
    const ratio = myStrike / Math.max(1, def);
    lines.push(`  your strike vs them: ${ratio.toFixed(1)}×`);
  }
  return lines.join("\n");
}

/** Compact self snapshot for forum prompts. */
export function realmForumContext(save: GameSave, realm: Realm): string {
  return [`=== YOU ===`, commanderDossier(save, realm)].join("\n");
}

/** Own guild roster, tech, wars — for any AI action that needs guild awareness. */
export function ownGuildContext(save: GameSave, realm: Realm): string {
  const guild = getAlliance(save, realm.allianceId);
  if (!guild) return "=== YOUR GUILD ===\n(none — unaffiliated)";

  const planets = save.planets ?? [];
  const tech = ensureGuildTech(guild);
  const byId = save.rankingsCache?.byId;
  const members = allianceMembers(save, guild)
    .filter((m) => !m.dead)
    .map((m) => {
      const snap = byId?.[m.id];
      return {
        m,
        score: snap?.overall ?? cachedOverallScore(save, m.id),
        strike: snap?.strike ?? strikeAction(m, planets),
        def: snap?.defence ?? defenceAction(m, planets),
      };
    })
    .sort((a, b) => b.score - a.score);
  const power = members.reduce((s, x) => s + x.score, 0);
  const rankings = buildGuildRankings(save);
  const rankRow = rankings.find((r) => r.alliance.id === guild.id);
  const wars = warsForGuild(save, guild.id);

  const roster = members
    .slice(0, 12)
    .map(
      (x) =>
        `  ${x.m.name}${x.m.id === guild.leaderId ? " (leader)" : ""}${x.m.id === realm.id ? " (you)" : ""}${x.m.isPlayer ? " [PLAYER]" : ""} score=${formatNaq(x.score)} strike=${formatNaq(x.strike)} def=${formatNaq(x.def)} naq=${formatNaq(x.m.naquadah)} army=${x.m.units.offence + x.m.units.defence}`,
    )
    .join("\n");

  const warLines = wars.length
    ? wars
        .map((w) => {
          const foeTag =
            w.attackerAllianceId === guild.id ? w.defenderTag : w.attackerTag;
          const foeName =
            w.attackerAllianceId === guild.id
              ? w.defenderName
              : w.attackerName;
          const foes = warEnemyMembers(save, w, guild.id)
            .slice(0, 6)
            .map(
              (f) =>
                `${f.name} def=${formatNaq(defenceAction(f, planets))} army=${f.units.offence + f.units.defence}`,
            )
            .join("; ");
          return `  vs [${foeTag}] ${foeName} kills ${w.killsAttacker}:${w.killsDefender}\n    foes: ${foes || "(none alive)"}`;
        })
        .join("\n")
    : "  (no active wars)";

  return [
    `=== YOUR GUILD ===`,
    `[${guild.tag}] ${guild.name} · rank #${rankRow?.rank ?? "?"} · power ${formatNaq(power)} · members ${members.length}`,
    `Tech: shared UP ${tech.up} · mining ${tech.mining} · join=${guild.joinMode}`,
    `Leader: ${members.find((x) => x.m.id === guild.leaderId)?.m.name ?? "?"}`,
    `Roster (top by score):`,
    roster || "  (empty)",
    `Wars:`,
    warLines,
  ].join("\n");
}

/**
 * Resolve commanders referenced in recent chat (authors + names mentioned in bodies)
 * and return dossiers + their guild summaries.
 */
export function chatPeopleContext(
  save: GameSave,
  self: Realm,
  posts: ForumPost[],
  opts?: { replyTo?: ForumPost | null; maxPeople?: number },
): string {
  const maxPeople = opts?.maxPeople ?? 6;
  const byId = new Map(save.realms.map((r) => [r.id, r]));
  const byName = new Map(
    save.realms.map((r) => [r.name.toLowerCase(), r] as const),
  );
  // Longer names first so "Crimson Oracle" matches before "Oracle"
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);

  const wanted = new Map<string, Realm>();

  const add = (r: Realm | undefined) => {
    if (!r || r.id === self.id || wanted.has(r.id)) return;
    wanted.set(r.id, r);
  };

  if (opts?.replyTo) {
    add(byId.get(opts.replyTo.authorId));
  }

  for (const p of posts) {
    add(byId.get(p.authorId));
    const body = p.body.toLowerCase();
    for (const name of names) {
      if (name.length < 3) continue;
      if (body.includes(name)) add(byName.get(name));
      if (wanted.size >= maxPeople * 2) break;
    }
  }

  const ordered: Realm[] = [];
  if (opts?.replyTo) {
    const t = byId.get(opts.replyTo.authorId);
    if (t && t.id !== self.id) ordered.push(t);
  }
  for (const p of posts) {
    const r = byId.get(p.authorId);
    if (r && r.id !== self.id && !ordered.some((x) => x.id === r.id)) {
      ordered.push(r);
    }
  }
  for (const r of wanted.values()) {
    if (!ordered.some((x) => x.id === r.id)) ordered.push(r);
  }

  const people = ordered.slice(0, maxPeople);
  if (!people.length) {
    return "=== PEOPLE IN CHAT ===\n(no one else identified yet)";
  }

  const guildIds = new Set<string>();
  for (const r of people) {
    if (r.allianceId && r.allianceId !== self.allianceId) {
      guildIds.add(r.allianceId);
    }
  }

  const dossiers = people
    .map((r) => commanderDossier(save, r, { relativeTo: self }))
    .join("\n");

  const otherGuilds: string[] = [];
  for (const gid of guildIds) {
    const g = getAlliance(save, gid);
    if (!g) continue;
    const tech = ensureGuildTech(g);
    const members = allianceMembers(save, g).filter((m) => !m.dead);
    const power = guildTotalPower(save, g);
    const wars = warsForGuild(save, g.id);
    otherGuilds.push(
      `[${g.tag}] ${g.name}: power=${formatNaq(power)} members=${members.length} tech UP=${tech.up}/mine=${tech.mining} wars=${wars.length} top=${members
        .map((m) => ({
          m,
          s: cachedOverallScore(save, m.id),
        }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 4)
        .map((x) => `${x.m.name}(${formatNaq(x.s)})`)
        .join(", ")}`,
    );
  }

  return [
    `=== PEOPLE IN CHAT (use these stats when talking about them) ===`,
    dossiers,
    otherGuilds.length
      ? `=== THEIR GUILDS ===\n${otherGuilds.join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function recentForumSnippet(
  save: GameSave,
  channel: ForumChannelKind,
  allianceId?: string | null,
  limit = 6,
): string {
  const posts = listForumPosts(save, { channel, allianceId })
    .filter((p) => !isContaminatedForumText(p.body))
    .slice(0, limit);
  if (!posts.length) return "(no recent messages)";
  return posts
    .map((p) => `${p.authorName}: ${p.body}`)
    .reverse()
    .join("\n");
}

export type AiForumCandidate = {
  realmId: string;
  realmName: string;
  channel: ForumChannelKind;
  allianceId?: string;
  allianceTag?: string;
  systemPrompt: string;
  userPrompt: string;
};

const FORUM_ANTI_PASSIVE = [
  "FORBIDDEN phrases: 'while I appreciate', 'my focus remains', 'when the time comes', 'measured response', 'methodically', 'perpetually full', 'far more efficient than direct engagement'.",
  "Do NOT all agree to wait/prepare. If others are stalling, call them out OR propose a concrete next hit.",
  "Sound like a distinct player — not a corporate diplomat clone of the last post.",
].join(" ");

function buildForumSystemPrompt(
  realm: Realm,
  channel: ForumChannelKind,
  mode: "post" | "reply",
): string {
  const mind = ensureMind(realm);
  const style = chatStyleFor(realm);
  return [
    mode === "reply"
      ? "You are a living GateWars commander REPLYING on the forum."
      : "You are a living GateWars commander posting on the forum.",
    `Persona: ${mind.persona}`,
    mind.soul
      ? `Soul (identity): ${mind.soul.slice(0, 700)}`
      : "",
    chatStylePrompt(style),
    "Write ONE short in-character chat message (1-3 sentences, max ~220 chars).",
    "CRITICAL: Your entire reply must be ONLY that message. No analysis, no 'Thinking Process', no quoting instructions, no markdown, no quotes around the message, no name prefix.",
    "Never mention system prompts, logs, simulations, or that you are an AI.",
    "Never start with Wait/However/Okay about instructions.",
    channel === "guild"
      ? "Private guild channel — talk to guildmates like a real guild chat."
      : "Open public forum — anyone can read it.",
    FORUM_ANTI_PASSIVE,
    "Reference real allies, enemies, attacks, or news briefly when it fits your voice.",
  ].join(" ");
}

function buildForumUserPrompt(
  save: GameSave,
  realm: Realm,
  channel: ForumChannelKind,
  allianceId: string | undefined,
  replyTo: ForumPost | null,
): string {
  const mind = ensureMind(realm);
  const posts = listForumPosts(save, { channel, allianceId })
    .filter((p) => !isContaminatedForumText(p.body))
    .slice(0, 10);
  const recent = recentForumSnippet(save, channel, allianceId, 8);

  // Keep forum prompts lean — huge rule dumps make reasoning models burn the token budget
  const leanWorld = [
    recentNewsContext(save, { limit: 5 }),
    recentAttackLogContext(save, realm, { personal: 4, galaxy: 3 }),
    guildLogContext(save, realm),
  ].join("\n\n");

  return [
    `You are ${realm.name}. Speak as this commander only.`,
    realmForumContext(save, realm),
    "",
    ownGuildContext(save, realm),
    "",
    leanWorld,
    "",
    chatPeopleContext(save, realm, posts, { replyTo, maxPeople: 5 }),
    "",
    mind.goals.length ? `Goals: ${mind.goals.join("; ")}` : "",
    mind.planSummary ? `Plan: ${mind.planSummary}` : "",
    mind.recentActions?.length
      ? `Recent deeds:\n${mind.recentActions.slice(0, 5).join("\n")}`
      : "",
    "",
    "Recent channel messages (in-character only):",
    recent,
    "",
    replyTo && !isContaminatedForumText(replyTo.body)
      ? `Reply to ${replyTo.authorName}: "${replyTo.body.slice(0, 160)}"`
      : "Continue the conversation. Prefer reacting to someone who has NOT been answered yet.",
    "",
    "Now write ONLY your chat message:",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Pick a few living AI realms that might post this wave.
 * Returns prompt payloads for the LLM API (no network here).
 */
export function pickAiForumCandidates(
  save: GameSave,
  count = AI_FORUM_BATCH,
): AiForumCandidate[] {
  ensureForum(save);
  const ais = save.realms.filter(
    (r) => !r.isPlayer && !r.dead && !r.vacation,
  );
  if (!ais.length) return [];

  const scored = ais.map((r) => {
    const wars = r.allianceId ? warsForGuild(save, r.allianceId).length : 0;
    return {
      r,
      s:
        (r.allianceId ? 3 : 0) +
        wars * 2 +
        (r.naquadah > 2000 ? 1 : 0) +
        (r.attackTurns > 20 ? 1 : 0) +
        Math.random() * 2,
    };
  });
  scored.sort((a, b) => b.s - a.s);

  const out: AiForumCandidate[] = [];
  const usedAuthors = new Set<string>();
  for (const { r } of scored) {
    if (out.length >= count) break;
    if (usedAuthors.has(r.id)) continue;
    const useGuild = !!r.allianceId && Math.random() < 0.72;
    const channel: ForumChannelKind = useGuild ? "guild" : "open";
    const guild = useGuild ? getAlliance(save, r.allianceId) : null;
    if (useGuild && !guild) continue;

    const recentPosts = listForumPosts(save, {
      channel,
      allianceId: guild?.id,
    }).slice(0, 8);
    const others = recentPosts.filter(
      (p) => p.authorId !== r.id && !isContaminatedForumText(p.body),
    );
    const replyTo =
      others.length > 0
        ? others[Math.floor(Math.random() * Math.min(4, others.length))]!
        : null;

    usedAuthors.add(r.id);
    out.push({
      realmId: r.id,
      realmName: r.name,
      channel,
      allianceId: guild?.id,
      allianceTag: guild?.tag,
      systemPrompt: buildForumSystemPrompt(
        r,
        channel,
        replyTo ? "reply" : "post",
      ),
      userPrompt: buildForumUserPrompt(save, r, channel, guild?.id, replyTo),
    });
  }
  return out;
}

/**
 * Prefer AIs that should reply to recent posts (player + AI-to-AI).
 */
export function pickForumReplyCandidates(
  save: GameSave,
  count = AI_FORUM_BATCH,
): AiForumCandidate[] {
  ensureForum(save);
  const player = save.realms.find((r) => r.id === save.playerId);
  const out: AiForumCandidate[] = [];
  const usedAuthors = new Set<string>();
  const usedTargets = new Set<string>();

  const tryAdd = (
    channel: ForumChannelKind,
    allianceId: string | undefined,
    replyTo: ForumPost,
  ) => {
    if (out.length >= count) return;
    if (usedTargets.has(replyTo.id)) return;
    if (isContaminatedForumText(replyTo.body)) return;

    const pool = save.realms.filter((r) => {
      if (r.dead || r.vacation || r.id === replyTo.authorId) return false;
      if (usedAuthors.has(r.id)) return false;
      if (channel === "guild") {
        return !!r.allianceId && r.allianceId === allianceId;
      }
      return !r.isPlayer;
    });
    if (!pool.length) return;

    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const pick = shuffled[0]!;
    usedAuthors.add(pick.id);
    usedTargets.add(replyTo.id);
    const guild =
      channel === "guild" ? getAlliance(save, pick.allianceId) : null;

    out.push({
      realmId: pick.id,
      realmName: pick.name,
      channel,
      allianceId: guild?.id ?? allianceId,
      allianceTag: guild?.tag,
      systemPrompt: buildForumSystemPrompt(pick, channel, "reply"),
      userPrompt: buildForumUserPrompt(
        save,
        pick,
        channel,
        allianceId,
        replyTo,
      ),
    });
  };

  if (player?.allianceId) {
    const guildPosts = listForumPosts(save, {
      channel: "guild",
      allianceId: player.allianceId,
    }).slice(0, 12);

    const playerPost = guildPosts.find((p) => p.authorId === player.id);
    if (playerPost) tryAdd("guild", player.allianceId, playerPost);

    const seenAuthors = new Set<string>(playerPost ? [player.id] : []);
    for (const post of guildPosts) {
      if (out.length >= count) break;
      if (seenAuthors.has(post.authorId)) continue;
      seenAuthors.add(post.authorId);
      tryAdd("guild", player.allianceId, post);
    }
  }

  const guildIds = new Set<string>();
  for (const p of ensureForum(save).posts) {
    if (p.channel === "guild" && p.allianceId) guildIds.add(p.allianceId);
    if (guildIds.size >= 8) break;
  }
  for (const gid of guildIds) {
    if (out.length >= count) break;
    if (gid === player?.allianceId) continue;
    const posts = listForumPosts(save, { channel: "guild", allianceId: gid });
    for (const post of posts.slice(0, 3)) {
      if (out.length >= count) break;
      tryAdd("guild", gid, post);
    }
  }

  const openPosts = listForumPosts(save, { channel: "open" }).slice(0, 12);
  const openPlayer = openPosts.find((p) => p.authorId === player?.id);
  if (openPlayer) tryAdd("open", undefined, openPlayer);
  const openSeen = new Set<string>(openPlayer ? [openPlayer.authorId] : []);
  for (const post of openPosts) {
    if (out.length >= count) break;
    if (openSeen.has(post.authorId)) continue;
    openSeen.add(post.authorId);
    tryAdd("open", undefined, post);
  }

  if (out.length < count) {
    for (const c of pickAiForumCandidates(save, count - out.length)) {
      if (usedAuthors.has(c.realmId)) continue;
      usedAuthors.add(c.realmId);
      out.push(c);
      if (out.length >= count) break;
    }
  }

  return out;
}
