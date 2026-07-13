import type {
  AiChatStyle,
  AiMind,
  AiPlanAction,
  AiPlanStep,
  GameSave,
  MarketCommodity,
  MarketSide,
  Realm,
  Units,
} from "@/lib/db/schema";
import {
  defenceAction,
  formatNaq,
  strikeAction,
  trainCost,
  upUpgradeCost,
} from "@/lib/game/economy";
import { cachedOverallScore } from "@/lib/game/rankings";
import {
  getAlliance,
  sameAlliance,
  buildGuildRankings,
} from "@/lib/game/guilds";
import { warsForGuild, warEnemyMembers, areGuildsAtWar } from "@/lib/game/wars";
import { listForumPosts, recentForumSnippet, ownGuildContext, chatPeopleContext } from "@/lib/game/forum";
import { buildWorldBriefing } from "@/lib/game/aiWorldContext";
import {
  threadsForRealm,
  mailCounterpartName,
  mailThreadPreview,
} from "@/lib/game/mail";
import { marketBoard } from "@/lib/game/market";
import { ascensionRequirements } from "@/lib/game/ascension";
import { RACES, starterWeapons } from "@/lib/game/races";
import {
  actionAttack,
  actionAscend,
  actionBuyWeapon,
  actionConquerPlanet,
  actionCovert,
  actionCreateGuild,
  actionDeclareWar,
  actionDeposit,
  actionEndWar,
  actionEradicate,
  actionForum,
  actionMail,
  actionFundGuildTech,
  actionJoinGuild,
  actionMarket,
  actionTrain,
  actionUpgradeBank,
  actionUpgradeMothership,
  actionUpgradeSpy,
  actionUpgradeTech,
  actionUpgradeUp,
  actionWithdraw,
} from "@/lib/game/actions";
import type { TechBranch } from "@/lib/game/economy";
import type { GuildTechBranch } from "@/lib/game/guilds";

export const MAX_MEMORIES = 24;
export const MAX_GOALS = 5;
export const MAX_PLAN_STEPS = 8;
/** Sliding deed window — newest first. */
export const MAX_RECENT_ACTIONS = 20;
export const MAX_ACTION_CHARS = 100;
/**
 * ~1000 tokens ≈ 4000 chars for English prose. Hard cap for soul files.
 */
export const MAX_SOUL_CHARS = 4000;
/** How often one AI may get a soul merge (ms). */
export const AI_SOUL_COOLDOWN_MS = 10 * 60_000;
/** Background soul merges — one AI at a time. */
export const AI_SOUL_BACKGROUND_BATCH = 1;
/** How often an AI may ask the LLM to rethink (ms). */
export const AI_THINK_COOLDOWN_MS = 90_000;
/** Max minds requested per manual/summon wave. */
export const AI_THINK_BATCH = 2;
/** Background auto-think keeps the UI responsive with a single mind. */
export const AI_THINK_BACKGROUND_BATCH = 1;

const ARCHETYPES = [
  "farmer",
  "aggressor",
  "turtle",
  "covert",
  "politician",
  "trader",
] as const;
type SeedArch = (typeof ARCHETYPES)[number];

function hashArch(id: string): SeedArch {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ARCHETYPES[h % ARCHETYPES.length]!;
}

function totalArmedHint(realm: Realm, slot: "attack" | "defence"): number {
  return realm.weapons
    .filter((w) => w.slot === slot)
    .reduce((s, w) => s + w.quantity, 0);
}

function damagedWeaponHint(realm: Realm): string {
  const damaged = realm.weapons.filter(
    (w) => w.quantity > 0 && w.durability < w.maxDurability * 0.85,
  );
  if (!damaged.length) return "none";
  return damaged
    .slice(0, 4)
    .map(
      (w) =>
        `${w.id} x${w.quantity} (${Math.floor((100 * w.durability) / w.maxDurability)}%)`,
    )
    .join(", ");
}

const PERSONA_SEEDS: Record<SeedArch, string[]> = {
  farmer: [
    "Patient empire-builder. Hoards Naq, pumps UP, only fights when the math is free.",
    "Quiet industrialist. Believes wars are for fools who skipped mining tech.",
  ],
  aggressor: [
    "Blood-and-gate raider. Lives for Strike ratios and wartime annihilations.",
    "Hot-headed fleet commander. Talks trash on the open forum, then proves it.",
  ],
  turtle: [
    "Paranoid fortress mind. Stacks defence, banks everything, never overextends.",
    "Shield-first strategist. Wins by outlasting louder rivals.",
  ],
  covert: [
    "Whisper-network spy. Prefers sabotage and intel over open fleet clashes.",
    "Shadow broker. Uses the forum to bait, then hits with agents.",
  ],
  politician: [
    "Guild kingmaker. Obsessed with alliances, wars, and public reputation.",
    "Diplomat with a dagger. Builds blocs, then declares war when the votes are in.",
  ],
  trader: [
    "Open Market shark. Floods UU when prices spike, scoops turns before raids.",
    "Naq arbitrage addict. Treats the galaxy like a ledger.",
  ],
};

const CHAT_STYLES: AiChatStyle[] = [
  "roleplay",
  "min_max",
  "hothead",
  "irl_vent",
  "lurker",
  "shitposter",
];

function hashChatStyle(id: string): AiChatStyle {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 33 + id.charCodeAt(i)) >>> 0;
  }
  return CHAT_STYLES[h % CHAT_STYLES.length]!;
}

export function chatStyleFor(realm: Realm): AiChatStyle {
  return realm.mind?.chatStyle ?? hashChatStyle(realm.id);
}

/** Prompt blurb describing how this commander chats. */
export function chatStylePrompt(style: AiChatStyle): string {
  switch (style) {
    case "roleplay":
      return "CHAT VOICE: deep in-character roleplay. Speak as your race/commander with lore flavor, titles, and drama. Never break character.";
    case "min_max":
      return "CHAT VOICE: cold spreadsheet player. Talk ratios, UP, Naq/hr, strike vs defence, market prices. Short and practical. Skip poetry.";
    case "hothead":
      return "CHAT VOICE: aggressive war-hawk. Push for attacks NOW, call out cowards, hype annihilations. Disagree loudly with anyone stalling.";
    case "irl_vent":
      return "CHAT VOICE: real person playing between life chaos. Mix game talk with random IRL asides (work shift, roommate, coffee, traffic, kids, sleep). Still play the game.";
    case "lurker":
      return "CHAT VOICE: quiet guildmate. Short dry replies, one-liners, occasional useful tip. Not speeches.";
    case "shitposter":
      return "CHAT VOICE: chaotic meme energy. Banter, jokes, mild trash talk, weird tangents — still about the war/game, not empty spam.";
  }
}

export function ensureMind(realm: Realm): AiMind {
  if (realm.mind) {
    if (!realm.mind.goals) realm.mind.goals = [];
    if (!realm.mind.memories) realm.mind.memories = [];
    if (!realm.mind.recentActions) realm.mind.recentActions = [];
    if (!realm.mind.plan) realm.mind.plan = [];
    if (!realm.mind.chatStyle) realm.mind.chatStyle = hashChatStyle(realm.id);
    if (!realm.mind.persona) {
      const arch = hashArch(realm.id);
      realm.mind.persona =
        PERSONA_SEEDS[arch][
          Math.abs(realm.id.length) % PERSONA_SEEDS[arch].length
        ]!;
    }
    return realm.mind;
  }
  const arch = hashArch(realm.id);
  const seeds = PERSONA_SEEDS[arch];
  realm.mind = {
    persona: seeds[Math.floor(Math.random() * seeds.length)]!,
    chatStyle: hashChatStyle(realm.id),
    goals: [],
    memories: [],
    recentActions: [],
    plan: [],
    thinkCount: 0,
  };
  return realm.mind;
}

export function pushMemory(realm: Realm, text: string): void {
  const mind = ensureMind(realm);
  const line = text.trim().slice(0, 220);
  if (!line) return;
  mind.memories.unshift(line);
  if (mind.memories.length > MAX_MEMORIES) {
    mind.memories = mind.memories.slice(0, MAX_MEMORIES);
  }
}

/** Record a concrete deed into the sliding action window. */
export function pushAction(realm: Realm, text: string): void {
  const mind = ensureMind(realm);
  if (!mind.recentActions) mind.recentActions = [];
  const line = text.trim().slice(0, MAX_ACTION_CHARS);
  if (!line) return;
  // Dedupe identical consecutive deeds
  if (mind.recentActions[0] === line) return;
  mind.recentActions.unshift(line);
  if (mind.recentActions.length > MAX_RECENT_ACTIONS) {
    mind.recentActions = mind.recentActions.slice(0, MAX_RECENT_ACTIONS);
  }
}

export function applySoulResult(realm: Realm, text: string): void {
  const mind = ensureMind(realm);
  const cleaned = text
    .trim()
    .replace(/^```[\w]*\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
    .slice(0, MAX_SOUL_CHARS);
  if (cleaned.length < 40) return;
  mind.soul = cleaned;
  mind.lastSoulAt = Date.now();
  mind.soulVersion = (mind.soulVersion ?? 0) + 1;
}

/** Rich context for the 64k-window planner / forum voice. */
export function buildAiContext(save: GameSave, realm: Realm): string {
  const mind = ensureMind(realm);
  const planets = save.planets ?? [];
  const race = RACES[realm.race];
  const guild = getAlliance(save, realm.allianceId);
  const wars = realm.allianceId ? warsForGuild(save, realm.allianceId) : [];
  const byId = save.rankingsCache?.byId;
  const score = cachedOverallScore(save, realm.id);
  const strike = strikeAction(realm, planets);
  const def = defenceAction(realm, planets);
  const req = ascensionRequirements(realm);
  const board = marketBoard(save);
  const rankings = buildGuildRankings(save).slice(0, 8);

  const realmById = new Map(save.realms.map((r) => [r.id, r] as const));
  const order = save.rankingsCache?.order.overall ?? save.realms.map((r) => r.id);
  const rivalPool: {
    id: string;
    name: string;
    score: number;
    def: number;
    ratio: number;
    naq: number;
    uu: number;
    war: boolean;
    guild: string | undefined;
  }[] = [];
  for (const id of order) {
    if (rivalPool.length >= 36) break;
    const r = realmById.get(id);
    if (!r || r.dead || r.vacation || r.isPlayer || r.id === realm.id) continue;
    if (sameAlliance(realm, r)) continue;
    const snap = byId?.[r.id];
    const d = snap?.defence ?? defenceAction(r, planets);
    const war = areGuildsAtWar(save, realm, r);
    rivalPool.push({
      id: r.id,
      name: r.name,
      score: snap?.overall ?? cachedOverallScore(save, r.id),
      def: d,
      ratio: strike / Math.max(1, d),
      naq: r.naquadah,
      uu: r.units.untrained,
      war,
      guild: getAlliance(save, r.allianceId)?.tag,
    });
  }
  const rivals = rivalPool
    .sort((a, b) => (b.war ? 1 : 0) - (a.war ? 1 : 0) || b.ratio - a.ratio)
    .slice(0, 12);

  const warRosters = wars.map((w) => {
    const foes = warEnemyMembers(save, w, realm.allianceId!).slice(0, 8);
    return {
      warId: w.id,
      vs:
        w.attackerAllianceId === realm.allianceId
          ? `[${w.defenderTag}] ${w.defenderName}`
          : `[${w.attackerTag}] ${w.attackerName}`,
      kills: `${w.killsAttacker}:${w.killsDefender}`,
      foes: foes.map((f) => {
        const snap = byId?.[f.id];
        return {
          id: f.id,
          name: f.name,
          def: snap?.defence ?? defenceAction(f, planets),
          army: f.units.offence + f.units.defence,
          score: snap?.overall ?? cachedOverallScore(save, f.id),
        };
      }),
    };
  });

  const openPosts = listForumPosts(save, { channel: "open" }).slice(0, 8);
  const openForum = openPosts
    .map((p) => `${p.authorName}: ${p.body}`)
    .join("\n");
  const guildPosts = guild
    ? listForumPosts(save, { channel: "guild", allianceId: guild.id }).slice(
        0,
        8,
      )
    : [];
  const guildForum = guild
    ? recentForumSnippet(save, "guild", guild.id, 6)
    : "(no guild)";

  const forumPeople = chatPeopleContext(
    save,
    realm,
    [...guildPosts, ...openPosts],
    { maxPeople: 8 },
  );

  const joinable = rankings
    .filter((g) => g.alliance.id !== realm.allianceId)
    .slice(0, 6)
    .map(
      (g) =>
        `${g.alliance.id} [${g.alliance.tag}] ${g.alliance.name} power=${formatNaq(g.power)} members=${g.members}`,
    )
    .join("\n");

  const upCost = upUpgradeCost(realm.unitProductionLevel);
  const pending = mind.plan.filter((s) => !s.done);

  return [
    buildWorldBriefing(save, realm),
    ``,
    `=== YOU ===`,
    `Name: ${realm.name}`,
    `Race: ${race.name}${realm.ascendedTitle ? ` (${realm.ascendedTitle})` : ""}`,
    `Persona: ${mind.persona}`,
    mind.soul
      ? `Soul file (long-term identity):\n${mind.soul.slice(0, MAX_SOUL_CHARS)}`
      : `Soul file: (none yet — being written over many sessions)`,
    `Chat style: ${mind.chatStyle ?? chatStyleFor(realm)} — ${chatStylePrompt(mind.chatStyle ?? chatStyleFor(realm))}`,
    `Goals: ${mind.goals.length ? mind.goals.join(" | ") : "(none yet)"}`,
    `Plan summary: ${mind.planSummary ?? "(none)"}`,
    `Pending plan steps: ${pending.length ? pending.map((s) => s.action + (s.note ? `(${s.note})` : "")).join(", ") : "(empty)"}`,
    `Recent deeds (sliding):`,
    mind.recentActions?.length
      ? mind.recentActions.slice(0, 12).join("\n")
      : "(none)",
    `Memories:`,
    mind.memories.length ? mind.memories.slice(0, 12).join("\n") : "(none)",
    ``,
    `=== STATUS ===`,
    `Score ${formatNaq(score)} · Strike ${formatNaq(strike)} · Defence ${formatNaq(def)}`,
    `Open Naq ${formatNaq(realm.naquadah)} · Bank ${formatNaq(realm.bankNaquadah)} · UP ${realm.unitProductionLevel} (next ${formatNaq(upCost)})`,
    `Attack turns ${Math.floor(realm.attackTurns)} · Covert cap ${realm.covertCapacity}`,
    `Units UU=${realm.units.untrained} miners=${realm.units.miners} off=${realm.units.offence} def=${realm.units.defence} cov=${realm.units.covert}`,
    `Weapons atk=${totalArmedHint(realm, "attack")}/${realm.units.offence} def=${totalArmedHint(realm, "defence")}/${realm.units.defence} (need arms if weapons < units)`,
    `Damaged weapons: ${damagedWeaponHint(realm)}`,
    `Guild: ${guild ? `[${guild.tag}] ${guild.name} (leader=${guild.leaderId === realm.id})` : "none"}`,
    `Faction: ${realm.factionId ?? "unaligned"}`,
    `Ascension: gloryOk=${req.gloryOk} ready=${req.ready} AP=${realm.ascensionPoints} level=${realm.ascensionLevel}`,
    `Mothership tier ${realm.mothership?.tier ?? 0}`,
    ``,
    ownGuildContext(save, realm),
    ``,
    `=== MARKET (mid) ===`,
    board.map((b) => `${b.commodity}: buy ${formatNaq(b.buy)} sell ${formatNaq(b.sell)} fair ${formatNaq(b.fair)} inv ${formatNaq(b.inventory)} flood=${b.flood.toFixed(2)}`).join("\n"),
    ``,
    `=== WARS ===`,
    wars.length
      ? warRosters
          .map(
            (w) =>
              `${w.warId} vs ${w.vs} kills ${w.kills}\n  foes: ${w.foes.map((f) => `${f.name}(${f.id}) def=${Math.floor(f.def)} army=${f.army}`).join("; ") || "none alive"}`,
          )
          .join("\n")
      : "No active guild wars",
    ``,
    `=== RIVAL SNAPSHOT ===`,
    rivals
      .map(
        (r) =>
          `${r.name}(${r.id}) score=${formatNaq(r.score)} ratio=${r.ratio.toFixed(2)} naq=${formatNaq(r.naq)} uu=${r.uu}${r.war ? " WAR" : ""}${r.guild ? ` [${r.guild}]` : ""}`,
      )
      .join("\n"),
    ``,
    `=== GUILDS TO JOIN/FIGHT ===`,
    joinable || "(none)",
    ``,
    forumPeople,
    ``,
    `=== OPEN FORUM (recent) ===`,
    openForum || "(quiet)",
    ``,
    `=== GUILD FORUM ===`,
    guildForum,
    ``,
    `=== YOUR MAIL (recent) ===`,
    (() => {
      const threads = threadsForRealm(save, realm.id).slice(0, 5);
      if (!threads.length) return "(no private mail)";
      return threads
        .map(
          (t) =>
            `${t.id} re:${t.subject} ↔ ${mailCounterpartName(save, t, realm.id)} — ${mailThreadPreview(t)}`,
        )
        .join("\n");
    })(),
  ].join("\n");
}

export function buildThinkSystemPrompt(): string {
  return [
    "You are a living GateWars commander — a real player in a wild multiplayer galaxy.",
    "Stay in character. Be opportunistic, emotional, political, greedy, or ruthless as your persona dictates.",
    "The user message includes GATEWARS RULES, UNIVERSE NEWS, ATTACK LOG, GUILD LOG, and your live status — use them.",
    "Your Soul file is long-term identity (grown slowly). Persona is a short tactical blurb — refine it, don't replace the soul.",
    "Recent deeds are what you actually did — remember them when planning.",
    "React to recent attacks, wars, and headlines when they matter to your goals.",
    "You MUST output a single JSON object only (no markdown fences, no commentary).",
    "Schema:",
    '{',
    '  "persona": "refined 1-2 sentence persona (evolve slowly)",',
    '  "goals": ["up to 5 short goals"],',
    '  "memory": "one new memory line about what you just decided or noticed",',
    '  "plan_summary": "what you are trying to do this session",',
    '  "plan": [',
    '    {"action":"ACTION","args":{...},"note":"why"}',
    "  ],",
    '  "forum": {"channel":"open"|"guild","body":"optional in-character post"}',
    "}",
    "Allowed ACTION values:",
    "train, upgrade_up, upgrade_tech, upgrade_spy, upgrade_bank, buy_weapon, repair_weapon, deposit, withdraw,",
    "market, attack, raid, eradicate, spy, sabotage, forum_open, forum_guild, mail, join_guild, create_guild,",
    "declare_war, end_war, fund_guild_tech, mothership, conquer_planet, ascend, wait",
    "Args examples:",
    'train: {"kind":"offence"|"defence"|"miners"|"covert"|"antiCovert","amount":20}',
    'upgrade_tech: {"branch":"mining"|"offence"|"defence"|"covert"|"equipment"|"general"}',
    'buy_weapon: {"weaponId":"...","amount":5}  (omit weaponId to buy cheapest attack weapon)',
    'repair_weapon: {"weaponId":"..."}  (omit to repair the most damaged stock)',
    'market: {"commodity":"untrained"|"attackTurns","side":"buy"|"sell","quantity":30}',
    'attack/raid: {"targetId":"...","turns":8}',
    'eradicate: {"targetId":"..."}  (requires ≥10× defence; 5% wipe chance per 10× tier)',
    'spy/sabotage: {"targetId":"...","agents":3}',
    'mail: {"toId":"...","subject":"…","body":"…"} or {"threadId":"...","body":"…"}',
    'join_guild: {"allianceId":"..."}',
    'create_guild: {"name":"My Pact"}',
    'declare_war: {"allianceId":"..."}',
    'end_war: {"warId":"..."}',
    'fund_guild_tech: {"branch":"up"|"mining"}',
    'conquer_planet: {"planetId":"..."}',
    'deposit/withdraw: {"amount":1000}',
    "Rules:",
    "- Prefer 3-6 concrete plan steps you can execute NOW with your current resources.",
    "- ECONOMY FIRST: if UU > 5, include train. If weapons < trained offence/defence, include buy_weapon.",
    "- If any weapons are damaged, include repair_weapon before attacking.",
    "- Do not attack with a hollow army — train + arm before raid/attack when strike is weak.",
    "- If strike ≥10× a foe's defence, prefer eradicate (kill move) especially in guild wars.",
    "- If at war, prioritize wartime enemies (attack/eradicate gutted foes).",
    "- If you were just attacked or your guild is at war, address that in goals/memory/forum when fitting.",
    "- Follow unfinished goals; do not thrash plans every think unless the situation changed.",
    "- If OPEN FORUM or GUILD FORUM shows messages from others, you SHOULD include forum with a short reply.",
    "- Prefer channel guild when you are in a guild and guild chat has activity; otherwise open.",
    '- Match your Chat style. Do NOT write corporate-diplomat stalling ("while I appreciate…"). Be opinionated.',
    "- Reply to other commanders by name — including other AIs — not only the loudest war-hawk.",
    "- forum body max ~280 chars; speak like a real player, not a bot. Never prefix with your own name.",
    "- Use real IDs from the context for targets, guilds, wars, planets.",
  ].join("\n");
}

export type ThinkResult = {
  persona?: string;
  goals?: string[];
  memory?: string;
  plan_summary?: string;
  plan?: Array<{
    action?: string;
    args?: Record<string, string | number | boolean>;
    note?: string;
  }>;
  forum?: { channel?: string; body?: string };
};

export function parseThinkJson(raw: string): ThinkResult | null {
  const text = raw.trim();
  // Strip fences if model ignored instructions
  const unfenced = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(unfenced.slice(start, end + 1)) as ThinkResult;
  } catch {
    return null;
  }
}

const ACTIONS = new Set<string>([
  "train",
  "upgrade_up",
  "upgrade_tech",
  "upgrade_spy",
  "upgrade_bank",
  "buy_weapon",
  "repair_weapon",
  "eradicate",
  "deposit",
  "withdraw",
  "market",
  "attack",
  "raid",
  "spy",
  "sabotage",
  "forum_open",
  "forum_guild",
  "mail",
  "join_guild",
  "create_guild",
  "declare_war",
  "end_war",
  "fund_guild_tech",
  "mothership",
  "conquer_planet",
  "ascend",
  "wait",
]);

export function applyThinkResult(realm: Realm, result: ThinkResult): void {
  const mind = ensureMind(realm);
  if (result.persona && result.persona.trim().length > 20) {
    mind.persona = result.persona.trim().slice(0, 400);
  }
  if (Array.isArray(result.goals)) {
    mind.goals = result.goals
      .map((g) => String(g).trim())
      .filter(Boolean)
      .slice(0, MAX_GOALS);
  }
  if (result.memory) pushMemory(realm, result.memory);
  if (result.plan_summary) {
    mind.planSummary = result.plan_summary.trim().slice(0, 240);
  }
  if (Array.isArray(result.plan)) {
    const steps: AiPlanStep[] = [];
    for (const s of result.plan.slice(0, MAX_PLAN_STEPS)) {
      const action = String(s.action ?? "").toLowerCase() as AiPlanAction;
      if (!ACTIONS.has(action)) continue;
      steps.push({
        action,
        args: s.args ?? {},
        note: s.note ? String(s.note).slice(0, 120) : undefined,
        done: false,
      });
    }
    if (steps.length) mind.plan = steps;
  }
  mind.lastThinkAt = Date.now();
  mind.lastPlanAt = Date.now();
  mind.thinkCount = (mind.thinkCount ?? 0) + 1;
}

function argNum(
  args: Record<string, string | number | boolean> | undefined,
  key: string,
  fallback: number,
): number {
  const v = args?.[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return fallback;
}

function argStr(
  args: Record<string, string | number | boolean> | undefined,
  key: string,
): string | undefined {
  const v = args?.[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return undefined;
}

/** Execute pending plan steps for one realm. Returns count completed this call. */
export function executeAiPlan(
  save: GameSave,
  realm: Realm,
  maxSteps = 4,
): number {
  const mind = ensureMind(realm);
  let done = 0;
  for (const step of mind.plan) {
    if (done >= maxSteps) break;
    if (step.done) continue;
    const err = runPlanStep(save, realm, step);
    step.done = true;
    step.result = err ?? "ok";
    if (!err) {
      done += 1;
      pushAction(
        realm,
        `Did ${step.action}${step.note ? `: ${step.note}` : ""}`,
      );
    } else {
      pushAction(realm, `Failed ${step.action}: ${err}`);
    }
  }
  // Drop finished prefix
  while (mind.plan[0]?.done) mind.plan.shift();
  return done;
}

function runPlanStep(
  save: GameSave,
  realm: Realm,
  step: AiPlanStep,
): string | null {
  const a = step.args ?? {};
  switch (step.action) {
    case "wait":
      return null;
    case "train": {
      const kind = (argStr(a, "kind") ?? "offence") as keyof Units;
      const amount = argNum(a, "amount", 10);
      if (!(kind in realm.units) || kind === "untrained") {
        return "Bad train kind";
      }
      // Cap by affordability
      const costEach = trainCost(kind);
      const maxByNaq =
        costEach > 0 ? Math.floor(realm.naquadah / costEach) : amount;
      const qty = Math.min(
        amount,
        realm.units.untrained,
        Math.max(0, maxByNaq),
      );
      if (qty < 1) return "Cannot afford / no UU";
      return actionTrain(realm, kind, qty);
    }
    case "upgrade_up":
      return actionUpgradeUp(realm);
    case "upgrade_tech": {
      const branch = (argStr(a, "branch") ?? "mining") as TechBranch;
      return actionUpgradeTech(realm, branch);
    }
    case "upgrade_spy":
      return actionUpgradeSpy(realm);
    case "upgrade_bank":
      return actionUpgradeBank(realm);
    case "buy_weapon": {
      let weaponId = argStr(a, "weaponId");
      if (!weaponId) {
        const catalog = [
          ...realm.weapons,
          ...starterWeapons(realm.race),
        ];
        const needAtk =
          realm.units.offence >
          realm.weapons
            .filter((w) => w.slot === "attack")
            .reduce((s, w) => s + w.quantity, 0);
        const slot = needAtk ? "attack" : "defence";
        const pick = catalog
          .filter((w) => w.slot === slot)
          .sort((x, y) => x.buyCost - y.buyCost)[0];
        weaponId = pick?.id;
      }
      if (!weaponId) return "No weapon";
      return actionBuyWeapon(realm, weaponId, argNum(a, "amount", 5));
    }
    case "repair_weapon": {
      let weaponId = argStr(a, "weaponId");
      if (!weaponId) {
        const damaged = realm.weapons
          .filter(
            (w) =>
              w.quantity > 0 && w.durability < w.maxDurability,
          )
          .sort(
            (a, b) =>
              a.durability / a.maxDurability -
              b.durability / b.maxDurability,
          )[0];
        weaponId = damaged?.id;
      }
      if (!weaponId) return "Nothing to repair";
      const w = realm.weapons.find((x) => x.id === weaponId);
      if (!w) return "Unknown weapon";
      const missing = w.maxDurability - w.durability;
      if (missing <= 0) return "Already repaired";
      const cost = Math.ceil(
        w.buyCost * 0.01 * missing * Math.max(1, w.quantity),
      );
      if (realm.naquadah < cost) return "Not enough Naquadah";
      realm.naquadah -= cost;
      w.durability = w.maxDurability;
      return null;
    }
    case "deposit":
      return actionDeposit(save, realm, argNum(a, "amount", 500));
    case "withdraw":
      return actionWithdraw(realm, argNum(a, "amount", 500));
    case "market": {
      const commodity = (argStr(a, "commodity") ??
        "untrained") as MarketCommodity;
      const side = (argStr(a, "side") ?? "sell") as MarketSide;
      return actionMarket(
        save,
        realm,
        commodity,
        side,
        argNum(a, "quantity", 20),
      );
    }
    case "attack":
    case "raid": {
      const targetId = argStr(a, "targetId");
      if (!targetId) return "Missing targetId";
      return actionAttack(
        save,
        realm,
        targetId,
        argNum(a, "turns", 8),
        step.action === "raid" ? "raid" : "attack",
      );
    }
    case "eradicate": {
      const targetId = argStr(a, "targetId");
      if (!targetId) return "Missing targetId";
      return actionEradicate(save, realm, targetId);
    }
    case "spy":
    case "sabotage": {
      const targetId = argStr(a, "targetId");
      if (!targetId) return "Missing targetId";
      return actionCovert(
        save,
        realm,
        targetId,
        step.action,
        argNum(a, "agents", 3),
      );
    }
    case "forum_open":
      return actionForum(
        save,
        realm,
        "open",
        argStr(a, "body") ?? step.note ?? "…",
        { isAi: true },
      );
    case "forum_guild":
      return actionForum(
        save,
        realm,
        "guild",
        argStr(a, "body") ?? step.note ?? "…",
        { isAi: true },
      );
    case "mail": {
      const body = argStr(a, "body") ?? step.note ?? "";
      if (!body.trim()) return "Empty mail";
      return actionMail(save, realm, {
        toId: argStr(a, "toId"),
        threadId: argStr(a, "threadId"),
        subject: argStr(a, "subject"),
        body,
        isAi: true,
      });
    }
    case "join_guild": {
      const id = argStr(a, "allianceId");
      if (!id) return "Missing allianceId";
      return actionJoinGuild(save, realm, id);
    }
    case "create_guild":
      return actionCreateGuild(
        save,
        realm,
        argStr(a, "name") ?? `${realm.name} Pact`,
      );
    case "declare_war": {
      const id = argStr(a, "allianceId");
      if (!id) return "Missing allianceId";
      return actionDeclareWar(save, realm, id);
    }
    case "end_war": {
      const id = argStr(a, "warId");
      if (!id) return "Missing warId";
      return actionEndWar(save, realm, id);
    }
    case "fund_guild_tech": {
      const branch = (argStr(a, "branch") ?? "up") as GuildTechBranch;
      return actionFundGuildTech(save, realm, branch);
    }
    case "mothership":
      return actionUpgradeMothership(realm);
    case "conquer_planet": {
      const id = argStr(a, "planetId");
      if (!id) {
        const free = (save.planets ?? []).find((p) => !p.ownerId);
        if (!free) return "No free planet";
        return actionConquerPlanet(save, realm, free.id);
      }
      return actionConquerPlanet(save, realm, id);
    }
    case "ascend":
      return actionAscend(realm);
    default:
      return `Unknown action ${step.action}`;
  }
}

/** Pick AIs that should think this wave (stale plan / no mind / overdue). */
export function pickThinkCandidates(
  save: GameSave,
  count = AI_THINK_BATCH,
  force = false,
): Realm[] {
  const now = Date.now();
  const includePlayer = !!save.settings.playerAiEnabled;
  const ais = save.realms.filter(
    (r) =>
      !r.dead &&
      !r.vacation &&
      (!r.isPlayer || (includePlayer && r.id === save.playerId)),
  );
  const scored = ais.map((r) => {
    const mind = r.mind;
    const pending = mind?.plan?.filter((s) => !s.done).length ?? 0;
    const overdue =
      !mind?.lastThinkAt || now - mind.lastThinkAt > AI_THINK_COOLDOWN_MS;
    const wars = r.allianceId ? warsForGuild(save, r.allianceId).length : 0;
    return {
      r,
      s:
        (r.isPlayer ? 12 : 0) +
        (overdue ? 5 : 0) +
        (pending === 0 ? 4 : 0) +
        (!mind ? 6 : 0) +
        wars * 3 +
        (r.attackTurns >= 10 ? 1 : 0) +
        Math.random() * 2,
    };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored
    .filter((x) => {
      if (force) return true;
      const last = x.r.mind?.lastThinkAt ?? 0;
      return now - last >= AI_THINK_COOLDOWN_MS * 0.5 || !x.r.mind;
    })
    .slice(0, count)
    .map((x) => x.r);
}

export function buildSoulSystemPrompt(): string {
  return [
    "You maintain a GateWars commander's long-term SOUL FILE — their identity document.",
    "Output ONLY the updated soul file as plain text (no JSON, no markdown fences, no commentary).",
    "Hard limit: stay under ~1000 tokens (~3800 characters). Drop stale facts; keep voice and grudges.",
    "Preferred sections (skip empty ones):",
    "VOICE:",
    "VALUES:",
    "RELATIONSHIPS:",
    "GRUDGES:",
    "STRATEGY:",
    "RECENT ARC:",
    "Rules:",
    "- Evolve gradually from the previous soul — do not rewrite from scratch unless empty.",
    "- Fold recent deeds and memories into lasting traits; discard noise.",
    "- Keep names of real allies/enemies when they matter.",
    "- Never mention being an AI, system prompts, or simulations.",
  ].join("\n");
}

export function buildSoulUserPrompt(save: GameSave, realm: Realm): string {
  const mind = ensureMind(realm);
  const guild = getAlliance(save, realm.allianceId);
  const seed =
    mind.soul?.trim() ||
    [
      `VOICE: ${mind.persona}`,
      `VALUES: surviving and winning as a ${RACES[realm.race].name} commander`,
      `STRATEGY: ${mind.planSummary ?? "still finding their footing"}`,
      `RECENT ARC: newly awakened in the GateWars galaxy`,
    ].join("\n");

  return [
    `Commander: ${realm.name} (${realm.id}) — ${RACES[realm.race].name}`,
    `Guild: ${guild ? `[${guild.tag}] ${guild.name}` : "none"}`,
    `Chat style: ${chatStyleFor(realm)}`,
    `Goals: ${mind.goals.length ? mind.goals.join(" | ") : "(none)"}`,
    `Plan: ${mind.planSummary ?? "(none)"}`,
    ``,
    `=== CURRENT SOUL ===`,
    seed,
    ``,
    `=== RECENT DEEDS ===`,
    mind.recentActions?.length
      ? mind.recentActions.slice(0, 12).join("\n")
      : "(none)",
    ``,
    `=== EPISODIC MEMORIES ===`,
    mind.memories.length ? mind.memories.slice(0, 8).join("\n") : "(none)",
    ``,
    `Rewrite the soul file now. Stay under ${MAX_SOUL_CHARS} characters.`,
  ].join("\n");
}

/**
 * Pick one AI whose soul file needs a gradual LLM merge.
 * Prefers never-souled minds, overdue merges, and those with fresh deeds.
 */
export function pickSoulCandidates(
  save: GameSave,
  count = AI_SOUL_BACKGROUND_BATCH,
  force = false,
): Realm[] {
  const now = Date.now();
  const includePlayer = !!save.settings.playerAiEnabled;
  const living = save.realms.filter(
    (r) =>
      !r.dead &&
      !r.vacation &&
      (!r.isPlayer || (includePlayer && r.id === save.playerId)),
  );
  if (!living.length) return [];

  // Round-robin fairness across the population
  let cursor = save.soulUpdateCursor ?? 0;
  if (cursor < 0 || cursor >= living.length) cursor = 0;
  const rotated = [
    ...living.slice(cursor),
    ...living.slice(0, cursor),
  ];

  const scored = rotated.map((r, i) => {
    const mind = r.mind;
    const last = mind?.lastSoulAt ?? 0;
    const overdue = !last || now - last >= AI_SOUL_COOLDOWN_MS;
    const deeds = mind?.recentActions?.length ?? 0;
    const never = !mind?.soul;
    return {
      r,
      i,
      s:
        (r.isPlayer ? 15 : 0) +
        (never ? 8 : 0) +
        (overdue ? 5 : 0) +
        (deeds >= 4 ? 3 : deeds > 0 ? 1 : 0) +
        ((mind?.thinkCount ?? 0) > 0 ? 2 : 0) +
        // Prefer earlier in round-robin window
        Math.max(0, 2 - i * 0.01) +
        Math.random() * 1.5,
    };
  });
  scored.sort((a, b) => b.s - a.s);

  const picked = scored
    .filter((x) => {
      if (force) return true;
      const last = x.r.mind?.lastSoulAt ?? 0;
      if (!x.r.mind?.soul) return true;
      return now - last >= AI_SOUL_COOLDOWN_MS * 0.5;
    })
    .slice(0, count)
    .map((x) => x.r);

  if (picked.length) {
    const lastId = picked[picked.length - 1]!.id;
    const idx = living.findIndex((r) => r.id === lastId);
    save.soulUpdateCursor = idx >= 0 ? (idx + 1) % living.length : cursor + 1;
  }

  return picked;
}
