import type {
  AttackLogEntry,
  GameSave,
  IntelLogEntry,
  Realm,
} from "@/lib/db/schema";
import { formatNaq } from "@/lib/game/economy";
import { ensureNews } from "@/lib/game/news";
import { getAlliance } from "@/lib/game/guilds";

/** Compact rules primer for LLM minds / forum — keep under ~1.5k chars. */
export const GAME_RULES_PRIMER = [
  "=== GATEWARS RULES (know these) ===",
  "Turn-based PBBG. Each production turn: gain Naquadah (Naq) + Untrained Units (UU) from economy/UP/planets.",
  "Naq = cash (train, weapons, tech, bank, market, guild tech). Banked Naq is protected from attacks; open Naq can be stolen.",
  "UU = population pool. Train into miners / offence / defence / covert / antiCovert. UP (unit production) permanently raises UU/turn and is never stolen.",
  "Attack Turns (AT): spend on Attack (steal open Naq), Raid (steal UU), or Eradicate (kill move).",
  "Combat: compare Strike vs Defence (rolls ~75–100% of potential). Win Attack → loot open Naq; weapons wear; big mismatches cause casualties.",
  "Eradicate: only if your Strike ≥10× their Defence; costs AT; ~5% wipe chance per 10× tier. Success destroys the realm.",
  "Covert: Spy (intel), Sabotage (damage weapons), Assassinate (kill spies). Uses covert capacity; defenders may detect you.",
  "Armory: buy/repair attack & defence weapons — unarmed troops fight poorly. Repair damaged stock before big fights.",
  "Tech branches (general/mining/offence/defence/covert/equipment) and mothership systems permanently boost power. Motherships expand weapon/shield capacity then fill bays — like classic Gate Wars.",
  "Guilds: shared roster, forum, tech (UP/mining). Leaders declare/end wars. Wartime enemies are priority targets.",
  "Market: buy/sell UU and Attack Turns for open Naq. Flooded inventory softens sell prices; scarce goods cost more.",
  "Ascension: meet glory/requirements → gain AP and a title; spend AP on permanent boosts.",
  "Races: Asgard +def, Goa'uld +income/free bank, Replicator balanced combat, Tau'ri +attack.",
  "Never invent IDs — use realm/guild/war/planet ids from context. Stay in character as a living commander.",
].join("\n");

function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function lossHint(u: Partial<{ untrained: number; offence: number; defence: number; covert: number; miners: number; antiCovert: number }> | undefined): string {
  if (!u) return "";
  const bits = Object.entries(u)
    .filter(([, v]) => typeof v === "number" && v > 0)
    .map(([k, v]) => `${k}:${v}`);
  return bits.length ? ` losses[${bits.join(",")}]` : "";
}

export function formatAttackLogLine(
  log: AttackLogEntry,
  opts?: { selfId?: string; now?: number },
): string {
  const when = ago(log.at, opts?.now);
  const youAtk = opts?.selfId && log.attackerId === opts.selfId;
  const youDef = opts?.selfId && log.defenderId === opts.selfId;
  const tag = youAtk ? "YOU→" : youDef ? "→YOU" : "";
  const result = log.won ? "WIN" : "LOSS";
  const loot =
    log.kind === "raid"
      ? ` UU+${formatNaq(log.uuStolen)}`
      : log.naqStolen > 0
        ? ` Naq+${formatNaq(log.naqStolen)}`
        : "";
  const era =
    log.kind === "eradicate" || log.eradicationAttempted
      ? log.eradicated
        ? " ERADICATED"
        : log.eradicationAttempted
          ? " eradicate-fail"
          : ""
      : "";
  return `${when} ${tag}[${log.kind}] ${log.attackerName}→${log.defenderName} ${result}${loot}${era} (${log.turnsUsed}AT)${lossHint(log.defenderLosses)} — ${log.summary.slice(0, 100)}`;
}

/** Recent battles involving this realm, then notable galaxy fights. */
export function recentAttackLogContext(
  save: GameSave,
  realm: Realm,
  opts?: { personal?: number; galaxy?: number },
): string {
  const personalN = opts?.personal ?? 10;
  const galaxyN = opts?.galaxy ?? 8;
  const logs = save.logs?.attacks ?? [];
  const now = Date.now();

  const personal = logs
    .filter((l) => l.attackerId === realm.id || l.defenderId === realm.id)
    .slice(0, personalN)
    .map((l) => formatAttackLogLine(l, { selfId: realm.id, now }));

  const galaxy = logs
    .filter((l) => l.attackerId !== realm.id && l.defenderId !== realm.id)
    .filter(
      (l) =>
        l.won ||
        l.kind === "eradicate" ||
        l.eradicated ||
        l.naqStolen > 5000 ||
        l.uuStolen > 200,
    )
    .slice(0, galaxyN)
    .map((l) => formatAttackLogLine(l, { now }));

  return [
    `=== RECENT ATTACK LOG (yours) ===`,
    personal.length ? personal.join("\n") : "(no recent battles involving you)",
    `=== GALAXY ATTACK HIGHLIGHTS ===`,
    galaxy.length ? galaxy.join("\n") : "(quiet galaxy)",
  ].join("\n");
}

export function recentNewsContext(
  save: GameSave,
  opts?: { limit?: number },
): string {
  const limit = opts?.limit ?? 14;
  const news = ensureNews(save).slice(0, limit);
  if (!news.length) {
    return "=== UNIVERSE NEWS ===\n(no headlines yet)";
  }
  const now = Date.now();
  return [
    `=== UNIVERSE NEWS ===`,
    ...news.map((n) => `${ago(n.at, now)} [${n.kind}] ${n.text}`),
  ].join("\n");
}

/** Own guild bulletin + active war scoreboard notes. */
export function guildLogContext(save: GameSave, realm: Realm): string {
  const guild = getAlliance(save, realm.allianceId);
  if (!guild) {
    return "=== GUILD LOG ===\n(no guild — unaffiliated)";
  }
  const now = Date.now();
  const bulletin = (guild.news ?? []).slice(0, 12);
  const wars = (save.wars ?? []).filter(
    (w) =>
      w.status === "active" &&
      (w.attackerAllianceId === guild.id || w.defenderAllianceId === guild.id),
  );

  const warLines = wars.map((w) => {
    const vsUs = w.attackerAllianceId === guild.id;
    const foe = vsUs
      ? `[${w.defenderTag}] ${w.defenderName}`
      : `[${w.attackerTag}] ${w.attackerName}`;
    const kills = vsUs
      ? `${w.killsAttacker}:${w.killsDefender}`
      : `${w.killsDefender}:${w.killsAttacker}`;
    return `  WAR vs ${foe} score ${kills} (declared ${ago(w.declaredAt, now)} by ${w.declaredByName}) id=${w.id}`;
  });

  // Pull universe news tagged guild/war that mentions our tag
  const related = ensureNews(save)
    .filter(
      (n) =>
        (n.kind === "guild" || n.kind === "war" || n.kind === "destruction") &&
        (n.text.includes(`[${guild.tag}]`) ||
          n.text.includes(guild.name) ||
          n.text.includes(guild.tag)),
    )
    .slice(0, 8)
    .map((n) => `${ago(n.at, now)} [${n.kind}] ${n.text}`);

  return [
    `=== GUILD LOG [${guild.tag}] ===`,
    bulletin.length
      ? bulletin.map((line, i) => `  ${i + 1}. ${line}`).join("\n")
      : "  (no guild bulletin entries)",
    warLines.length ? `Active wars:\n${warLines.join("\n")}` : "Active wars: none",
    related.length
      ? `Related headlines:\n${related.map((l) => `  ${l}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatIntelLine(log: IntelLogEntry, selfId: string, now: number): string {
  const youAtk = log.actorId === selfId;
  const youDef = log.targetId === selfId;
  const tag = youAtk ? "YOU→" : youDef ? "→YOU" : "";
  const result = log.success ? "ok" : "fail";
  const det = log.detected ? " detected" : "";
  return `${ago(log.at, now)} ${tag}[${log.kind}] ${log.actorName}→${log.targetName} ${result}${det} — ${log.details.slice(0, 120)}`;
}

export function recentIntelLogContext(
  save: GameSave,
  realm: Realm,
  opts?: { limit?: number },
): string {
  const limit = opts?.limit ?? 6;
  const logs = (save.logs?.intelligence ?? []).filter(
    (l) => l.actorId === realm.id || l.targetId === realm.id,
  );
  const now = Date.now();
  const lines = logs
    .slice(0, limit)
    .map((l) => formatIntelLine(l, realm.id, now));
  return [
    `=== COVERT / INTEL LOG (yours) ===`,
    lines.length ? lines.join("\n") : "(no recent spy/sabotage involving you)",
  ].join("\n");
}

/**
 * Full world briefing for mind planning / forum: rules + news + attacks + guild.
 */
export function buildWorldBriefing(
  save: GameSave,
  realm: Realm,
  opts?: { compact?: boolean },
): string {
  if (opts?.compact) {
    return [
      GAME_RULES_PRIMER,
      "",
      recentNewsContext(save, { limit: 8 }),
      "",
      recentAttackLogContext(save, realm, { personal: 6, galaxy: 5 }),
      "",
      guildLogContext(save, realm),
    ].join("\n");
  }
  return [
    GAME_RULES_PRIMER,
    "",
    recentNewsContext(save, { limit: 14 }),
    "",
    recentAttackLogContext(save, realm, { personal: 10, galaxy: 8 }),
    "",
    recentIntelLogContext(save, realm, { limit: 6 }),
    "",
    guildLogContext(save, realm),
  ].join("\n");
}
