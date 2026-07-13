import type {
  GameSave,
  MailMessage,
  MailState,
  MailThread,
  Realm,
} from "@/lib/db/schema";
import { DEFAULT_MAIL } from "@/lib/db/schema";
import {
  commanderDossier,
  isContaminatedForumText,
  ownGuildContext,
} from "@/lib/game/forum";
import {
  buildWorldBriefing,
  recentAttackLogContext,
  recentNewsContext,
} from "@/lib/game/aiWorldContext";
import { sameAlliance } from "@/lib/game/guilds";
import { areGuildsAtWar } from "@/lib/game/wars";
import {
  chatStyleFor,
  chatStylePrompt,
  ensureMind,
} from "@/lib/game/mind";
import { RACES } from "@/lib/game/races";
import { strikeAction, defenceAction, uid } from "@/lib/game/economy";

export const MAX_MAIL_THREADS = 200;
export const MAX_MAIL_MESSAGES = 80;
export const MAX_MAIL_BODY = 2000;
export const MAX_MAIL_SUBJECT = 80;
export const AI_MAIL_COOLDOWN_MS = 55_000;
export const AI_MAIL_BATCH = 3;

/** ~4 chars/token rough budget for packing long threads into 128k context. */
export const MAIL_CONTEXT_TOKEN_BUDGET = 128_000;
const CHARS_PER_TOKEN = 4;
const MAIL_PROMPT_CHAR_BUDGET = Math.floor(
  MAIL_CONTEXT_TOKEN_BUDGET * CHARS_PER_TOKEN * 0.72,
);

export function ensureMail(save: GameSave): MailState {
  if (!save.mail) save.mail = structuredClone(DEFAULT_MAIL);
  if (!save.mail.threads) save.mail.threads = [];
  return save.mail;
}

export function pruneMail(save: GameSave): void {
  const mail = ensureMail(save);
  for (const t of mail.threads) {
    if (t.messages.length > MAX_MAIL_MESSAGES) {
      t.messages = t.messages.slice(-MAX_MAIL_MESSAGES);
    }
  }
  mail.threads.sort((a, b) => b.updatedAt - a.updatedAt);
  if (mail.threads.length > MAX_MAIL_THREADS) {
    mail.threads = mail.threads.slice(0, MAX_MAIL_THREADS);
  }
}

function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function otherParticipant(thread: MailThread, realmId: string): string {
  return thread.participantIds[0] === realmId
    ? thread.participantIds[1]!
    : thread.participantIds[0]!;
}

export function threadsForRealm(save: GameSave, realmId: string): MailThread[] {
  return ensureMail(save)
    .threads.filter((t) => t.participantIds.includes(realmId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getMailThread(
  save: GameSave,
  threadId: string,
): MailThread | undefined {
  return ensureMail(save).threads.find((t) => t.id === threadId);
}

export function unreadCountForRealm(save: GameSave, realmId: string): number {
  let n = 0;
  for (const t of threadsForRealm(save, realmId)) {
    const last = t.messages[t.messages.length - 1];
    if (!last) continue;
    if (last.authorId === realmId) continue;
    const readAt = t.lastReadAt[realmId] ?? 0;
    if (last.at > readAt) n += 1;
  }
  return n;
}

export function markThreadRead(
  save: GameSave,
  realmId: string,
  threadId: string,
): void {
  const t = getMailThread(save, threadId);
  if (!t || !t.participantIds.includes(realmId)) return;
  const last = t.messages[t.messages.length - 1];
  t.lastReadAt[realmId] = last?.at ?? Date.now();
}

function sanitizeMailBody(body: string): string {
  let text = body.trim().replace(/\r\n/g, "\n");
  text = text.replace(/^["'`]+|["'`]+$/g, "").trim();
  if (isContaminatedForumText(text)) return "";
  if (/thinking process\s*:/i.test(text)) return "";
  return text.slice(0, MAX_MAIL_BODY);
}

function sanitizeSubject(subject: string): string {
  return subject.trim().replace(/\s+/g, " ").slice(0, MAX_MAIL_SUBJECT);
}

export function startMailThread(
  save: GameSave,
  author: Realm,
  opts: { toId: string; subject: string; body: string; isAi?: boolean },
): MailThread {
  ensureMail(save);
  if (author.dead) throw new Error("Destroyed realms cannot send mail");
  if (author.vacation) throw new Error("Vacation mode — mail locked");
  if (opts.toId === author.id) throw new Error("Cannot mail yourself");

  const to = save.realms.find((r) => r.id === opts.toId);
  if (!to || to.dead) throw new Error("Recipient not found");

  const subject = sanitizeSubject(opts.subject || "No subject");
  const body = sanitizeMailBody(opts.body);
  if (body.length < 1) throw new Error("Message is empty");

  const now = Date.now();
  const msg: MailMessage = {
    id: uid("msg"),
    at: now,
    authorId: author.id,
    authorName: author.name,
    isAi: !!opts.isAi || !author.isPlayer,
    body,
  };

  const thread: MailThread = {
    id: uid("mail"),
    subject,
    participantIds: pairKey(author.id, to.id),
    starterId: author.id,
    createdAt: now,
    updatedAt: now,
    messages: [msg],
    lastReadAt: { [author.id]: now },
  };

  save.mail.threads.unshift(thread);
  pruneMail(save);
  return thread;
}

export function replyMailThread(
  save: GameSave,
  author: Realm,
  opts: { threadId: string; body: string; isAi?: boolean },
): MailMessage {
  ensureMail(save);
  if (author.dead) throw new Error("Destroyed realms cannot send mail");
  if (author.vacation) throw new Error("Vacation mode — mail locked");

  const thread = getMailThread(save, opts.threadId);
  if (!thread) throw new Error("Thread not found");
  if (!thread.participantIds.includes(author.id)) {
    throw new Error("Not a participant in this thread");
  }

  const body = sanitizeMailBody(opts.body);
  if (body.length < 1) throw new Error("Message is empty");

  const now = Date.now();
  const msg: MailMessage = {
    id: uid("msg"),
    at: now,
    authorId: author.id,
    authorName: author.name,
    isAi: !!opts.isAi || !author.isPlayer,
    body,
  };
  thread.messages.push(msg);
  thread.updatedAt = now;
  thread.lastReadAt[author.id] = now;
  pruneMail(save);
  return msg;
}

function trimToBudget(parts: string[], budget: number): string {
  let out = "";
  for (const p of parts) {
    if (!p) continue;
    if (out.length + p.length + 2 > budget) {
      const room = budget - out.length - 20;
      if (room > 80) out += `\n${p.slice(0, room)}\n…[truncated]`;
      break;
    }
    out += (out ? "\n\n" : "") + p;
  }
  return out;
}

function threadTranscript(thread: MailThread, maxChars: number): string {
  const lines: string[] = [
    `Subject: ${thread.subject}`,
    `Thread id: ${thread.id}`,
  ];
  // Prefer newest messages if we must truncate
  const msgs = [...thread.messages];
  const chunks: string[] = [];
  let used = lines.join("\n").length;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]!;
    const line = `[${new Date(m.at).toISOString()}] ${m.authorName}: ${m.body}`;
    if (used + line.length + 1 > maxChars) break;
    chunks.unshift(line);
    used += line.length + 1;
  }
  return [...lines, "---", ...chunks].join("\n");
}

export type AiMailCandidate = {
  kind: "start" | "reply";
  realmId: string;
  realmName: string;
  threadId?: string;
  toId?: string;
  systemPrompt: string;
  userPrompt: string;
};

function buildMailSystemPrompt(realm: Realm, kind: "start" | "reply"): string {
  const mind = ensureMind(realm);
  const style = chatStyleFor(realm);
  return [
    kind === "reply"
      ? "You are a GateWars commander writing a PRIVATE mail reply."
      : "You are a GateWars commander opening a PRIVATE mail thread.",
    `Persona: ${mind.persona}`,
    mind.soul ? `Soul: ${mind.soul.slice(0, 600)}` : "",
    chatStylePrompt(style),
    "This is email-style diplomacy — longer and more personal than forum chat is OK (up to ~800 chars).",
    "Output ONLY the mail body text. No subject line, no 'Dear X:' required, no Thinking Process, no JSON, no markdown fences.",
    "Never mention being an AI, system prompts, or simulations.",
    "You may negotiate, threaten, beg, recruit, trade tips, or settle grudges — stay in character.",
  ].join(" ");
}

function buildMailContextPack(
  save: GameSave,
  self: Realm,
  other: Realm,
  thread?: MailThread,
): string {
  const mind = ensureMind(self);
  const parts = [
    `=== YOU ===\n${commanderDossier(save, self)}`,
    ownGuildContext(save, self),
    `=== COUNTERPARTY ===\n${commanderDossier(save, other, { relativeTo: self })}`,
    buildWorldBriefing(save, self, { compact: true }),
    recentNewsContext(save, { limit: 10 }),
    recentAttackLogContext(save, self, { personal: 8, galaxy: 6 }),
    mind.goals.length ? `Goals: ${mind.goals.join("; ")}` : "",
    mind.planSummary ? `Plan: ${mind.planSummary}` : "",
    mind.soul ? `Soul:\n${mind.soul.slice(0, 800)}` : "",
    mind.recentActions?.length
      ? `Recent deeds:\n${mind.recentActions.slice(0, 8).join("\n")}`
      : "",
    mind.memories.length
      ? `Memories:\n${mind.memories.slice(0, 8).join("\n")}`
      : "",
  ];
  if (thread) {
    parts.push(
      `=== MAIL THREAD ===\n${threadTranscript(thread, Math.floor(MAIL_PROMPT_CHAR_BUDGET * 0.45))}`,
    );
  }
  return trimToBudget(parts.filter(Boolean), MAIL_PROMPT_CHAR_BUDGET);
}

function pickMailCounterpart(
  save: GameSave,
  self: Realm,
): Realm | undefined {
  const planets = save.planets ?? [];
  const living = save.realms.filter(
    (r) => !r.dead && !r.vacation && r.id !== self.id,
  );
  if (!living.length) return undefined;

  const scored = living.map((r) => {
    let s = Math.random() * 2;
    if (areGuildsAtWar(save, self, r)) s += 5;
    if (sameAlliance(self, r)) s += 2;
    if (r.isPlayer) s += 4;
    const ratio =
      strikeAction(self, planets) / Math.max(1, defenceAction(r, planets));
    if (ratio > 3) s += 1.5;
    if (r.naquadah > self.naquadah * 2) s += 1;
    // Prefer people we've already mailed (continuations feel natural)
    const prior = threadsForRealm(save, self.id).some((t) =>
      t.participantIds.includes(r.id),
    );
    if (prior) s += 1.2;
    return { r, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored[0]?.r;
}

/**
 * Pick AI mail actions: prefer replying to unread inbox, else start new threads.
 */
export function pickAiMailCandidates(
  save: GameSave,
  count = AI_MAIL_BATCH,
): AiMailCandidate[] {
  ensureMail(save);
  const out: AiMailCandidate[] = [];
  const usedAuthors = new Set<string>();

  // --- Replies to unread mail ---
  const replyJobs: Array<{ author: Realm; thread: MailThread; other: Realm }> =
    [];
  for (const t of ensureMail(save).threads) {
    const last = t.messages[t.messages.length - 1];
    if (!last) continue;
    for (const pid of t.participantIds) {
      if (pid === last.authorId) continue;
      const author = save.realms.find((r) => r.id === pid);
      if (!author || author.dead || author.vacation || author.isPlayer) continue;
      const readAt = t.lastReadAt[pid] ?? 0;
      if (last.at <= readAt) continue;
      const otherId = otherParticipant(t, pid);
      const other = save.realms.find((r) => r.id === otherId);
      if (!other || other.dead) continue;
      replyJobs.push({ author, thread: t, other });
    }
  }
  replyJobs.sort((a, b) => b.thread.updatedAt - a.thread.updatedAt);

  for (const job of replyJobs) {
    if (out.length >= count) break;
    if (usedAuthors.has(job.author.id)) continue;
    usedAuthors.add(job.author.id);
    out.push({
      kind: "reply",
      realmId: job.author.id,
      realmName: job.author.name,
      threadId: job.thread.id,
      toId: job.other.id,
      systemPrompt: buildMailSystemPrompt(job.author, "reply"),
      userPrompt: [
        `You are ${job.author.name}. Reply privately to ${job.other.name}.`,
        buildMailContextPack(save, job.author, job.other, job.thread),
        "",
        `Last message from ${lastAuthorLabel(job.thread)} — write your reply body only:`,
      ].join("\n"),
    });
  }

  // --- New threads ---
  const starters = save.realms
    .filter((r) => !r.isPlayer && !r.dead && !r.vacation)
    .map((r) => ({
      r,
      s:
        (r.allianceId ? 1 : 0) +
        (r.attackTurns > 30 ? 1 : 0) +
        Math.random() * 3,
    }))
    .sort((a, b) => b.s - a.s);

  for (const { r } of starters) {
    if (out.length >= count) break;
    if (usedAuthors.has(r.id)) continue;
    if (Math.random() > 0.55 && out.some((c) => c.kind === "reply")) continue;
    const other = pickMailCounterpart(save, r);
    if (!other) continue;
    usedAuthors.add(r.id);
    const race = RACES[r.race].name;
    const reasonHints = [
      "propose a temporary non-aggression or trade tip",
      "threaten or warn about an upcoming strike",
      "recruit them into (or against) a guild",
      "ask about market prices or dump coordination",
      "settle a personal score from a recent fight",
      "share intel about a mutual wartime foe",
    ];
    const hint = reasonHints[Math.floor(Math.random() * reasonHints.length)]!;
    out.push({
      kind: "start",
      realmId: r.id,
      realmName: r.name,
      toId: other.id,
      systemPrompt: buildMailSystemPrompt(r, "start"),
      userPrompt: [
        `You are ${r.name} (${race}). Open a private mail to ${other.name}.`,
        buildMailContextPack(save, r, other),
        "",
        `Purpose: ${hint}.`,
        "First line may be a short SUBJECT: line, then the body. Or just the body.",
        "Write the mail now:",
      ].join("\n"),
    });
  }

  return out;
}

function lastAuthorLabel(thread: MailThread): string {
  const last = thread.messages[thread.messages.length - 1];
  return last?.authorName ?? "them";
}

/** Parse optional SUBJECT: first line from model output for new threads. */
export function parseMailLlmOutput(text: string): {
  subject?: string;
  body: string;
} {
  let raw = text.trim().replace(/\r\n/g, "\n");
  raw = raw.replace(/^["'`]+|["'`]+$/g, "").trim();
  const m = raw.match(/^SUBJECT\s*:\s*(.+)\n([\s\S]*)$/i);
  if (m) {
    return {
      subject: sanitizeSubject(m[1] ?? "Dispatch"),
      body: sanitizeMailBody(m[2] ?? ""),
    };
  }
  return { body: sanitizeMailBody(raw) };
}

export function applyAiMailResult(
  save: GameSave,
  candidate: AiMailCandidate,
  rawText: string,
): boolean {
  const author = save.realms.find((r) => r.id === candidate.realmId);
  if (!author || author.dead) return false;
  const parsed = parseMailLlmOutput(rawText);
  if (!parsed.body) return false;

  try {
    if (candidate.kind === "reply" && candidate.threadId) {
      replyMailThread(save, author, {
        threadId: candidate.threadId,
        body: parsed.body,
        isAi: true,
      });
      return true;
    }
    if (candidate.kind === "start" && candidate.toId) {
      const subject =
        parsed.subject ||
        `Dispatch from ${author.name}`.slice(0, MAX_MAIL_SUBJECT);
      startMailThread(save, author, {
        toId: candidate.toId,
        subject,
        body: parsed.body,
        isAi: true,
      });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** Score helper for UI lists. */
export function mailThreadPreview(thread: MailThread): string {
  const last = thread.messages[thread.messages.length - 1];
  if (!last) return "(empty)";
  const snip = last.body.replace(/\s+/g, " ").slice(0, 90);
  return `${last.authorName}: ${snip}${last.body.length > 90 ? "…" : ""}`;
}

export function mailCounterpartName(
  save: GameSave,
  thread: MailThread,
  selfId: string,
): string {
  const oid = otherParticipant(thread, selfId);
  return save.realms.find((r) => r.id === oid)?.name ?? "Unknown";
}
