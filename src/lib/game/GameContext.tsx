"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AttackLogEntry,
  GameSave,
  IntelLogEntry,
  RaceId,
  Realm,
} from "@/lib/db/schema";
import {
  clearGame,
  exportSaveJson,
  flushSaveToServer,
  importSaveJson,
  loadGame,
  loadGameAsync,
  saveGame,
} from "@/lib/db/localStore";
import { createNewGame } from "@/lib/db/seed";
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
  depositFeeRate,
  ensureTech,
  mothershipStats,
  mothershipUpgradeCost,
  mothershipArmamentUnitCost,
  spyUpgradeCost,
  techBranchCost,
  upgradeMothershipPart,
  expandMothershipCapacity,
  installMothershipArmament,
  ensureMothershipParts,
  MOTHERSHIP_MAX_TIER,
  type TechBranch,
  trainCost,
  upUpgradeCost,
  type MothershipPartId,
  type MothershipArmamentKind,
} from "@/lib/game/economy";
import { catchUpTurns, forceTick, msUntilNextTurn } from "@/lib/game/turns";
import {
  catchUpTurnsAsync,
  catchUpAiAsync,
  refreshRankingsIfDueAsync,
} from "@/lib/game/simScheduler";
import { setGameClock } from "@/lib/game/gameClock";
import { starterWeapons } from "@/lib/game/races";
import {
  catchUpAi,
  clampAiActorsPerPulse,
  forceAiPulse,
  msUntilNextAiPulse,
} from "@/lib/game/ai";
import { msUntilRankingsRefresh } from "@/lib/game/rankings";
import { DEFAULT_TECH, EMPTY_MOTHERSHIP } from "@/lib/db/schema";
import { performAscension, spendAscensionPoints } from "@/lib/game/ascension";
import {
  createAlliance,
  joinAlliance,
  leaveAlliance,
  upgradeGuildTech,
  depositGuildFund,
  withdrawGuildFund,
  type GuildTechBranch,
} from "@/lib/game/guilds";
import {
  dissolveFleetCluster,
  joinFleetCluster,
  kickFromFleetCluster,
  leaveFleetCluster,
  startFleetCluster,
} from "@/lib/game/fleetClusters";
import {
  cancelDonationRequest,
  createDonationRequest,
  declineDonationRequest,
  fulfillDonationRequest,
} from "@/lib/game/contracts";
import { declareGuildWar, endGuildWarByLeader } from "@/lib/game/wars";
import { executeMarketTrade } from "@/lib/game/market";
import {
  AI_FORUM_COOLDOWN_MS,
  createForumPost,
  ensureForum,
  pickForumReplyCandidates,
} from "@/lib/game/forum";
import {
  AI_MAIL_COOLDOWN_MS,
  applyAiMailResult,
  ensureMail,
  markThreadRead,
  pickAiMailCandidates,
  replyMailThread,
  startMailThread,
  unreadCountForRealm,
} from "@/lib/game/mail";
import { requestForumLlm, requestMindLlm, requestMailLlm } from "@/lib/game/llmClient";
import {
  AI_SOUL_BACKGROUND_BATCH,
  AI_THINK_BACKGROUND_BATCH,
  AI_THINK_BATCH,
  applySoulResult,
  applyThinkResult,
  buildAiContext,
  buildSoulSystemPrompt,
  buildSoulUserPrompt,
  buildThinkSystemPrompt,
  ensureMind,
  executeAiPlan,
  parseThinkJson,
  pickSoulCandidates,
  pickThinkCandidates,
  pushMemory,
} from "@/lib/game/mind";
import type {
  ContractScope,
  FactionId,
  ForumChannelKind,
  MarketCommodity,
  MarketSide,
} from "@/lib/db/schema";

function llmFromSave(save: GameSave) {
  return {
    baseUrl: save.settings.llmBaseUrl,
    model: save.settings.llmModel,
    apiKey: save.settings.llmApiKey,
  };
}

type GameContextValue = {
  save: GameSave | null;
  ready: boolean;
  player: Realm | null;
  rivals: Realm[];
  mailUnread: number;
  startGame: (name: string, race: RaceId) => void;
  resetGame: () => void;
  persist: () => void;
  tickNow: () => void;
  aiPulseNow: () => number;
  setAiEnabled: (on: boolean) => void;
  setPlayerAiEnabled: (on: boolean) => void;
  setAiPulsesPerHour: (n: number) => void;
  setAiActorsPerPulse: (n: number) => void;
  setRankingsRefreshMinutes: (n: number) => void;
  refreshRankingsNow: () => Promise<void>;
  setLlmSettings: (opts: {
    baseUrl: string;
    model: string;
    apiKey?: string;
  }) => Promise<string | null>;
  train: (kind: keyof Realm["units"], amount: number) => string | null;
  untrain: (kind: keyof Realm["units"], amount: number) => string | null;
  upgradeUp: () => string | null;
  upgradeUpMax: (limit?: number) => { count: number; error: string | null };
  upgradeSpy: () => string | null;
  upgradeAntiSpy: () => string | null;
  upgradeTech: () => string | null;
  upgradeTechBranch: (branch: TechBranch) => string | null;
  upgradeTechBranchMax: (
    branch: TechBranch,
    limit?: number,
  ) => { count: number; error: string | null };
  upgradeBank: () => string | null;
  upgradeMothership: () => string | null;
  upgradeMothershipMax: (limit?: number) => {
    count: number;
    error: string | null;
  };
  upgradeMothershipPart: (part: MothershipPartId) => string | null;
  upgradeMothershipPartMax: (
    part: MothershipPartId,
    limit?: number,
  ) => { count: number; error: string | null };
  expandMothershipCapacity: (kind: MothershipArmamentKind) => string | null;
  expandMothershipCapacityMax: (
    kind: MothershipArmamentKind,
    limit?: number,
  ) => { count: number; error: string | null };
  installMothershipArmament: (
    kind: MothershipArmamentKind,
    qty?: number,
  ) => string | null;
  installMothershipArmamentMax: (
    kind: MothershipArmamentKind,
  ) => { count: number; error: string | null };
  repairMothership: () => string | null;
  buyWeapon: (weaponId: string, qty: number) => string | null;
  repairWeapon: (weaponId: string) => string | null;
  sellWeapon: (weaponId: string, qty: number) => string | null;
  deposit: (amount: number) => string | null;
  withdraw: (amount: number) => string | null;
  attack: (targetId: string, turns: number, kind?: "attack" | "raid") => AttackLogEntry | string;
  eradicate: (targetId: string) => AttackLogEntry | string;
  conquerPlanet: (planetId: string) => AttackLogEntry | string;
  createGuild: (name: string) => string | null;
  joinGuild: (allianceId: string) => string | null;
  leaveGuild: () => string | null;
  startFleetCluster: () => string | null;
  joinFleetCluster: (clusterId?: string) => string | null;
  leaveFleetCluster: () => string | null;
  kickFromFleetCluster: (realmId: string) => string | null;
  dissolveFleetCluster: () => string | null;
  declareWar: (targetAllianceId: string) => string | null;
  endWar: (warId: string) => string | null;
  upgradeGuildTechBranch: (branch: GuildTechBranch) => string | null;
  depositGuildFund: (amount: number) => string | null;
  withdrawGuildFund: (amount: number) => string | null;
  requestDonation: (opts: {
    amount: number;
    message?: string;
    scope: ContractScope;
    targetId?: string | null;
  }) => string | null;
  fulfillDonation: (contractId: string) => string | null;
  cancelDonation: (contractId: string) => string | null;
  declineDonation: (contractId: string) => string | null;
  marketTrade: (opts: {
    commodity: MarketCommodity;
    side: MarketSide;
    quantity: number;
  }) => string | null;
  postForum: (channel: ForumChannelKind, body: string) => string | null;
  /** Ask queued LLM for a few AI forum posts. Pass force to skip cooldown. */
  pulseForumAi: (force?: boolean) => Promise<{ posted: number; error?: string }>;
  /** AI private mail wave — start/continue threads (128k context). */
  pulseMailAi: (force?: boolean) => Promise<{ sent: number; error?: string }>;
  sendMail: (opts: {
    toId: string;
    subject: string;
    body: string;
  }) => string | null;
  replyMail: (opts: { threadId: string; body: string }) => string | null;
  readMailThread: (threadId: string) => void;
  /** LLM think wave: refine personas, set plans, optionally post, execute steps. */
  pulseAiMinds: (force?: boolean) => Promise<{
    thought: number;
    executed: number;
    posted: number;
    error?: string;
  }>;
  setFaction: (factionId: import("@/lib/db/schema").FactionId) => string | null;
  spy: (targetId: string, agents: number) => IntelLogEntry | string;
  sabotage: (targetId: string, agents: number) => IntelLogEntry | string;
  assassinate: (targetId: string, agents: number) => IntelLogEntry | string;
  setVacation: (on: boolean) => void;
  setTurnMinutes: (m: number) => void;
  renamePlayer: (name: string) => string | null;
  changeRace: (race: RaceId) => string | null;
  ascend: () => string | { apGained: number; title: string };
  spendAp: (amount: number, sink: "up" | "naq" | "tech") => string | null;
  exportJson: () => string;
  importJson: (json: string) => string | null;
  getRealm: (id: string) => Realm | undefined;
};

const GameContext = createContext<GameContextValue | null>(null);

const MAX_ATTACK_LOGS = 400;
const MAX_INTEL_LOGS = 200;
/** Always keep this many player-related attack rows even under AI spam. */
const RESERVED_PLAYER_ATTACK_LOGS = 120;

function trimLogs(save: GameSave) {
  if (!save.logs) save.logs = { attacks: [], intelligence: [] };
  if (!save.logs.attacks) save.logs.attacks = [];
  if (!save.logs.intelligence) save.logs.intelligence = [];

  const playerId = save.playerId;
  const attacks = save.logs.attacks;
  if (attacks.length > MAX_ATTACK_LOGS) {
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
    const keepPlayer = playerRelated.slice(0, RESERVED_PLAYER_ATTACK_LOGS);
    const room = Math.max(0, MAX_ATTACK_LOGS - keepPlayer.length);
    save.logs.attacks = [...keepPlayer, ...other.slice(0, room)];
  }

  save.logs.intelligence = save.logs.intelligence.slice(0, MAX_INTEL_LOGS);
}

function clampPulses(n: number) {
  return Math.max(1, Math.min(120, Math.floor(n)));
}

function mutatePlayer(
  save: GameSave,
  fn: (p: Realm) => string | null,
): string | null {
  const p = save.realms.find((r) => r.id === save.playerId);
  if (!p) return "No player";
  const err = fn(p);
  return err;
}

export function GameProvider({ children }: { children: ReactNode }) {
  const [save, setSave] = useState<GameSave | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const existing = await loadGameAsync();
        if (!cancelled) {
          setSave(existing);
          setReady(true);
        }
      } catch (e) {
        console.error("Failed to load save", e);
        if (!cancelled) {
          setSave(null);
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onLeave = () => {
      void flushSaveToServer();
    };
    window.addEventListener("beforeunload", onLeave);
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      window.removeEventListener("pagehide", onLeave);
      void flushSaveToServer();
    };
  }, []);

  const persist = useCallback(() => {
    setSave((prev) => {
      if (!prev) return prev;
      trimLogs(prev);
      saveGame(prev);
      // Shallow copy so React notices without cloning 40k realms
      return { ...prev };
    });
  }, []);

  const commit = useCallback((next: GameSave) => {
    trimLogs(next);
    saveGame(next);
    // Handlers already cloned — do not structuredClone again
    startTransition(() => {
      setSave(next);
    });
  }, []);

  const saveRef = useRef(save);
  saveRef.current = save;
  const simBusyRef = useRef(false);

  // Soft commit from background jobs — avoids double-clone and keeps navigation responsive
  const softCommit = useCallback((next: GameSave) => {
    trimLogs(next);
    saveGame(next);
    startTransition(() => {
      setSave(next);
    });
  }, []);

  // Countdown clock — module store so ticks don't re-render every page
  useEffect(() => {
    if (!save?.playerId) return;
    const id = window.setInterval(() => {
      const current = saveRef.current;
      if (!current) return;
      const now = Date.now();
      const turnMs = msUntilNextTurn(current, now);
      const aiMs = msUntilNextAiPulse(current, now);
      const rankMs = msUntilRankingsRefresh(current, now);
      setGameClock({ msToTurn: turnMs, msToAiPulse: aiMs });

      if (turnMs > 0 && aiMs > 0 && rankMs > 0) return;
      if (simBusyRef.current) return;

      simBusyRef.current = true;
      void (async () => {
        try {
          const prev = saveRef.current;
          if (!prev) return;
          // Mutate in place — no structuredClone of 40k realms on the hot path
          const ranks = await refreshRankingsIfDueAsync(prev, Date.now());
          if (ranks) await new Promise<void>((r) => setTimeout(r, 0));
          const turns = await catchUpTurnsAsync(prev, Date.now(), 1);
          if (turns > 0) {
            await new Promise<void>((r) => setTimeout(r, 0));
          }
          const ai = await catchUpAiAsync(prev, Date.now(), 1);
          setGameClock({
            msToTurn: msUntilNextTurn(prev),
            msToAiPulse: msUntilNextAiPulse(prev),
          });
          if (turns > 0 || ai > 0 || ranks) {
            softCommit(prev);
          }
        } finally {
          simBusyRef.current = false;
        }
      })();
    }, 1000);
    return () => clearInterval(id);
  }, [
    save?.playerId,
    save?.settings.turnMinutes,
    save?.settings.aiPulsesPerHour,
    save?.settings.aiEnabled,
    save?.settings.rankingsRefreshMinutes,
    softCommit,
  ]);

  // Background AI minds — one at a time so navigation stays usable
  useEffect(() => {
    if (!save?.playerId) return;
    if (
      save.settings.aiEnabled === false &&
      !save.settings.playerAiEnabled
    ) {
      return;
    }
    let cancelled = false;
    let busy = false;

    const tick = async () => {
      if (cancelled || busy) return;
      busy = true;
      try {
        const current = saveRef.current ?? loadGame();
        if (!current) return;
        if (
          current.settings.aiEnabled === false &&
          !current.settings.playerAiEnabled
        ) {
          return;
        }
        const candidates = pickThinkCandidates(
          current,
          AI_THINK_BACKGROUND_BATCH,
        );
        if (!candidates.length) return;

        const results: Array<
          { id: string; text: string } | { id: string; error: string }
        > = [];
        for (const c of candidates) {
          if (cancelled) return;
          const live = current.realms.find((r) => r.id === c.id) ?? c;
          ensureMind(live);
          // Yield so React can process navigation clicks between heavy work
          await new Promise<void>((r) => setTimeout(r, 0));
          const ctx = buildAiContext(current, live);
          const res = await requestMindLlm({
            systemPrompt: buildThinkSystemPrompt(),
            userPrompt: [
              ctx,
              "",
              "Think as this commander. Output JSON only.",
            ].join("\n"),
            maxTokens: 2048,
            ...llmFromSave(current),
          });
          if ("error" in res) results.push({ id: c.id, error: res.error });
          else results.push({ id: c.id, text: res.text });
        }
        if (cancelled) return;

        const latest = saveRef.current ?? loadGame() ?? current;
        const copy = structuredClone(latest);
        let thought = 0;
        let posted = 0;
        for (const r of results) {
          if (!r || "error" in r || !("text" in r)) continue;
          const realm = copy.realms.find((x) => x.id === r.id);
          if (!realm || realm.dead) continue;
          const parsed = parseThinkJson(r.text);
          if (!parsed) {
            pushMemory(realm, "Confused — LLM returned unreadable plan");
            continue;
          }
          applyThinkResult(realm, parsed);
          thought += 1;
          executeAiPlan(copy, realm, 4);
          if (parsed.forum?.body) {
            let channel: ForumChannelKind =
              parsed.forum.channel === "guild" ? "guild" : "open";
            if (channel === "guild" && !realm.allianceId) channel = "open";
            try {
              createForumPost(copy, realm, {
                channel,
                body: String(parsed.forum.body).slice(0, 500),
                isAi: true,
              });
              posted += 1;
            } catch {
              /* skip */
            }
          }
        }
        if (thought > 0 || posted > 0) {
          ensureForum(copy).lastAiChatAt = Date.now();
          softCommit(copy);
        }
      } finally {
        busy = false;
      }
    };

    const id = window.setInterval(() => {
      void tick();
    }, 45_000);
    const first = window.setTimeout(() => {
      void tick();
    }, 12_000);
    return () => {
      cancelled = true;
      clearInterval(id);
      clearTimeout(first);
    };
  }, [
    save?.playerId,
    save?.settings.aiEnabled,
    save?.settings.playerAiEnabled,
    softCommit,
  ]);

  // Background soul-file merges — one AI at a time, slower than think
  useEffect(() => {
    if (!save?.playerId) return;
    if (
      save.settings.aiEnabled === false &&
      !save.settings.playerAiEnabled
    ) {
      return;
    }
    let cancelled = false;
    let busy = false;

    const tick = async () => {
      if (cancelled || busy) return;
      busy = true;
      try {
        const current = saveRef.current ?? loadGame();
        if (!current) return;
        if (
          current.settings.aiEnabled === false &&
          !current.settings.playerAiEnabled
        ) {
          return;
        }
        const candidates = pickSoulCandidates(
          current,
          AI_SOUL_BACKGROUND_BATCH,
        );
        if (!candidates.length) return;

        const results: Array<
          { id: string; text: string } | { id: string; error: string }
        > = [];
        for (const c of candidates) {
          if (cancelled) return;
          const live = current.realms.find((r) => r.id === c.id) ?? c;
          ensureMind(live);
          await new Promise<void>((r) => setTimeout(r, 0));
          const res = await requestMindLlm({
            systemPrompt: buildSoulSystemPrompt(),
            userPrompt: buildSoulUserPrompt(current, live),
            maxTokens: 1024,
            temperature: 0.55,
            purpose: "mind",
            ...llmFromSave(current),
          });
          if ("error" in res) results.push({ id: c.id, error: res.error });
          else results.push({ id: c.id, text: res.text });
        }
        if (cancelled) return;

        const latest = saveRef.current ?? loadGame() ?? current;
        const copy = structuredClone(latest);
        // Preserve round-robin cursor advanced by pickSoulCandidates
        copy.soulUpdateCursor = current.soulUpdateCursor;
        let updated = 0;
        for (const r of results) {
          if (!r || "error" in r || !("text" in r)) continue;
          const realm = copy.realms.find((x) => x.id === r.id);
          if (!realm || realm.dead) continue;
          const before = realm.mind?.soulVersion ?? 0;
          applySoulResult(realm, r.text);
          if ((realm.mind?.soulVersion ?? 0) > before) updated += 1;
        }
        if (updated > 0) softCommit(copy);
      } finally {
        busy = false;
      }
    };

    const id = window.setInterval(() => {
      void tick();
    }, 90_000);
    const first = window.setTimeout(() => {
      void tick();
    }, 25_000);
    return () => {
      cancelled = true;
      clearInterval(id);
      clearTimeout(first);
    };
  }, [
    save?.playerId,
    save?.settings.aiEnabled,
    save?.settings.playerAiEnabled,
    softCommit,
  ]);

  // Background forum chatter — dedicated replies (guild + open), separate from mind plans
  useEffect(() => {
    if (!save?.playerId) return;
    if (save.settings.aiEnabled === false) return;
    let cancelled = false;
    let busy = false;

    const tick = async () => {
      if (cancelled || busy) return;
      busy = true;
      try {
        const current = saveRef.current ?? loadGame();
        if (!current || current.settings.aiEnabled === false) return;
        const forum = ensureForum(current);
        const now = Date.now();
        const playerPostedRecently = forum.posts.some(
          (p) =>
            p.authorId === current.playerId && now - p.at < 90_000,
        );
        const cooldown = playerPostedRecently
          ? 8_000
          : AI_FORUM_COOLDOWN_MS;
        if (
          forum.lastAiChatAt &&
          now - forum.lastAiChatAt < cooldown
        ) {
          return;
        }

        const candidates = pickForumReplyCandidates(current, 2);
        if (!candidates.length) return;

        const results: Array<
          | { candidate: (typeof candidates)[0]; text: string }
          | { error: string }
        > = [];
        for (const c of candidates) {
          if (cancelled) return;
          await new Promise<void>((r) => setTimeout(r, 0));
          const res = await requestForumLlm({
            systemPrompt: c.systemPrompt,
            userPrompt: c.userPrompt,
            ...llmFromSave(current),
          });
          if ("error" in res) results.push({ error: res.error });
          else results.push({ candidate: c, text: res.text });
        }
        if (cancelled) return;

        const latest = saveRef.current ?? loadGame() ?? current;
        const copy = structuredClone(latest);
        ensureForum(copy);
        let posted = 0;
        for (const r of results) {
          if (!r || "error" in r) continue;
          const author = copy.realms.find((x) => x.id === r.candidate.realmId);
          if (!author || author.dead) continue;
          let channel = r.candidate.channel;
          if (channel === "guild" && !author.allianceId) channel = "open";
          const body = r.text.trim().slice(0, 500);
          if (!body) continue;
          try {
            createForumPost(copy, author, {
              channel,
              body,
              isAi: true,
            });
            posted += 1;
          } catch {
            /* skip */
          }
        }
        if (posted > 0) {
          ensureForum(copy).lastAiChatAt = Date.now();
          softCommit(copy);
        }
      } finally {
        busy = false;
      }
    };

    const id = window.setInterval(() => {
      void tick();
    }, 28_000);
    const first = window.setTimeout(() => {
      void tick();
    }, 8_000);
    return () => {
      cancelled = true;
      clearInterval(id);
      clearTimeout(first);
    };
  }, [save?.playerId, save?.settings.aiEnabled, softCommit]);

  // Background private mail — AI start/continue threads (128k context prompts)
  useEffect(() => {
    if (!save?.playerId) return;
    if (save.settings.aiEnabled === false) return;
    let cancelled = false;
    let busy = false;

    const tick = async () => {
      if (cancelled || busy) return;
      busy = true;
      try {
        const current = saveRef.current ?? loadGame();
        if (!current || current.settings.aiEnabled === false) return;
        const mail = ensureMail(current);
        const now = Date.now();
        if (
          mail.lastAiMailAt &&
          now - mail.lastAiMailAt < AI_MAIL_COOLDOWN_MS
        ) {
          return;
        }
        const candidates = pickAiMailCandidates(current, 2);
        if (!candidates.length) return;

        const results: Array<
          | { candidate: (typeof candidates)[0]; text: string }
          | { error: string }
        > = [];
        for (const c of candidates) {
          if (cancelled) return;
          await new Promise<void>((r) => setTimeout(r, 0));
          const res = await requestMailLlm({
            systemPrompt: c.systemPrompt,
            userPrompt: c.userPrompt,
            ...llmFromSave(current),
          });
          if ("error" in res) results.push({ error: res.error });
          else results.push({ candidate: c, text: res.text });
        }
        if (cancelled) return;

        const latest = saveRef.current ?? loadGame() ?? current;
        const copy = structuredClone(latest);
        ensureMail(copy);
        let sent = 0;
        for (const r of results) {
          if (!r || "error" in r) continue;
          if (applyAiMailResult(copy, r.candidate, r.text)) sent += 1;
        }
        if (sent > 0) {
          ensureMail(copy).lastAiMailAt = Date.now();
          softCommit(copy);
        }
      } finally {
        busy = false;
      }
    };

    const id = window.setInterval(() => {
      void tick();
    }, 40_000);
    const first = window.setTimeout(() => {
      void tick();
    }, 18_000);
    return () => {
      cancelled = true;
      clearInterval(id);
      clearTimeout(first);
    };
  }, [save?.playerId, save?.settings.aiEnabled, softCommit]);

  const player = useMemo(
    () => save?.realms.find((r) => r.id === save.playerId) ?? null,
    [save],
  );
  // Do not filter 40k rivals on every save tick — pages that need lists build them locally
  const rivals = useMemo(() => [] as Realm[], []);
  const mailUnread = useMemo(() => {
    if (!save?.playerId) return 0;
    ensureMail(save);
    return unreadCountForRealm(save, save.playerId);
  }, [save]);

  const value: GameContextValue = {
    save,
    ready,
    player,
    rivals,
    mailUnread,
    startGame: (name, race) => {
      const g = createNewGame(name.trim() || "Commander", race);
      commit(g);
    },
    resetGame: () => {
      clearGame();
      setSave(null);
    },
    persist,
    tickNow: () => {
      if (!save) return;
      const copy = structuredClone(save);
      forceTick(copy);
      commit(copy);
    },
    aiPulseNow: () => {
      if (!save) return 0;
      const copy = structuredClone(save);
      const n = forceAiPulse(copy);
      trimLogs(copy);
      commit(copy);
      return n;
    },
    setAiEnabled: (on) => {
      if (!save) return;
      const copy = structuredClone(save);
      copy.settings.aiEnabled = on;
      if (on && !copy.lastAiPulseAt) copy.lastAiPulseAt = Date.now();
      commit(copy);
    },
    setPlayerAiEnabled: (on) => {
      if (!save) return;
      const copy = structuredClone(save);
      copy.settings.playerAiEnabled = on;
      if (on) {
        const p = copy.realms.find((r) => r.id === copy.playerId);
        if (p) ensureMind(p);
        // Ensure rival AI pulses keep running so autopilot has a clock
        if (copy.settings.aiEnabled === false) {
          copy.settings.aiEnabled = true;
        }
        if (!copy.lastAiPulseAt) copy.lastAiPulseAt = Date.now();
      }
      commit(copy);
    },
    setAiPulsesPerHour: (n) => {
      if (!save) return;
      const copy = structuredClone(save);
      copy.settings.aiPulsesPerHour = clampPulses(n);
      copy.lastAiPulseAt = Date.now();
      commit(copy);
    },
    setAiActorsPerPulse: (n) => {
      if (!save) return;
      const copy = structuredClone(save);
      copy.settings.aiActorsPerPulse = clampAiActorsPerPulse(n);
      commit(copy);
    },
    setRankingsRefreshMinutes: (n) => {
      if (!save) return;
      const copy = structuredClone(save);
      copy.settings.rankingsRefreshMinutes = Math.max(
        1,
        Math.min(24 * 60, Math.floor(n) || 60),
      );
      // Force due on next tick
      copy.lastRankingsRefreshAt = 0;
      commit(copy);
    },
    refreshRankingsNow: async () => {
      const prev = saveRef.current;
      if (!prev || simBusyRef.current) return;
      simBusyRef.current = true;
      try {
        await refreshRankingsIfDueAsync(prev, Date.now(), true);
        softCommit(prev);
      } finally {
        simBusyRef.current = false;
      }
    },
    setLlmSettings: async ({ baseUrl, model, apiKey }) => {
      if (!save) return "No save loaded";
      const url = baseUrl.trim().replace(/\/+$/, "");
      const mod = model.trim();
      if (!url) return "Endpoint URL is required";
      if (!mod) return "Model id is required";
      try {
        if (typeof URL.canParse === "function") {
          if (!URL.canParse(url)) {
            return "Endpoint must be a valid URL (e.g. http://host:1234/v1)";
          }
        } else {
          // eslint-disable-next-line no-new
          new URL(url);
        }
      } catch {
        return "Endpoint must be a valid URL (e.g. http://host:1234/v1)";
      }
      const copy = structuredClone(save);
      copy.settings.llmBaseUrl = url;
      copy.settings.llmModel = mod;
      if (apiKey != null) copy.settings.llmApiKey = apiKey;
      commit(copy);
      await flushSaveToServer();
      return null;
    },
    train: (kind, amount) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const err = mutatePlayer(copy, (p) => {
        if (kind === "untrained") return "Cannot train into untrained";
        const qty = Math.floor(amount);
        if (qty < 1) return "Invalid amount";
        if (p.units.untrained < qty) return "Not enough untrained units";
        const cost = trainCost(kind) * qty;
        if (p.naquadah < cost) return "Not enough Naquadah";
        p.units.untrained -= qty;
        p.units[kind] += qty;
        p.naquadah -= cost;
        return null;
      });
      if (err) return err;
      commit(copy);
      return null;
    },
    untrain: (kind, amount) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const err = mutatePlayer(copy, (p) => {
        if (kind === "untrained") return "Invalid";
        const qty = Math.floor(amount);
        if (qty < 1 || p.units[kind] < qty) return "Not enough units";
        p.units[kind] -= qty;
        p.units.untrained += qty;
        return null;
      });
      if (err) return err;
      commit(copy);
      return null;
    },
    upgradeUp: () => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const err = mutatePlayer(copy, (p) => {
        const cost = upUpgradeCost(p.unitProductionLevel);
        if (p.naquadah < cost) return "Not enough Naquadah";
        p.naquadah -= cost;
        p.unitProductionLevel += 1;
        return null;
      });
      if (err) return err;
      commit(copy);
      return null;
    },
    upgradeUpMax: (limit = 25) => {
      if (!save) return { count: 0, error: "No save" };
      const copy = structuredClone(save);
      let count = 0;
      let error: string | null = null;
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return { count: 0, error: "No player" };
      for (let i = 0; i < limit; i++) {
        const cost = upUpgradeCost(p.unitProductionLevel);
        if (p.naquadah < cost) {
          error = count === 0 ? "Not enough Naquadah" : null;
          break;
        }
        p.naquadah -= cost;
        p.unitProductionLevel += 1;
        count += 1;
      }
      if (count > 0) commit(copy);
      return { count, error };
    },
    upgradeSpy: () => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const err = mutatePlayer(copy, (p) => {
        const cost = spyUpgradeCost(p.spyLevel);
        if (p.naquadah < cost) return "Not enough Naquadah";
        p.naquadah -= cost;
        p.spyLevel += 1;
        return null;
      });
      if (err) return err;
      commit(copy);
      return null;
    },
    upgradeAntiSpy: () => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const err = mutatePlayer(copy, (p) => {
        const cost = antiSpyUpgradeCost(p.antiSpyLevel);
        if (p.naquadah < cost) return "Not enough Naquadah";
        p.naquadah -= cost;
        p.antiSpyLevel += 1;
        return null;
      });
      if (err) return err;
      commit(copy);
      return null;
    },
    upgradeTech: () => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const err = mutatePlayer(copy, (p) => {
        const tech = ensureTech(p);
        const cost = techBranchCost("general", tech.general);
        if (p.naquadah < cost) return "Not enough Naquadah";
        p.naquadah -= cost;
        tech.general += 1;
        p.techLevel = tech.general;
        return null;
      });
      if (err) return err;
      commit(copy);
      return null;
    },
    upgradeTechBranch: (branch) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const err = mutatePlayer(copy, (p) => {
        const tech = ensureTech(p);
        const cost = techBranchCost(branch, tech[branch]);
        if (p.naquadah < cost) return "Not enough Naquadah";
        p.naquadah -= cost;
        tech[branch] += 1;
        if (branch === "general") p.techLevel = tech.general;
        return null;
      });
      if (err) return err;
      commit(copy);
      return null;
    },
    upgradeTechBranchMax: (branch, limit = 15) => {
      if (!save) return { count: 0, error: "No save" };
      const copy = structuredClone(save);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return { count: 0, error: "No player" };
      const tech = ensureTech(p);
      let count = 0;
      let error: string | null = null;
      for (let i = 0; i < limit; i++) {
        const cost = techBranchCost(branch, tech[branch]);
        if (p.naquadah < cost) {
          error = count === 0 ? "Not enough Naquadah" : null;
          break;
        }
        p.naquadah -= cost;
        tech[branch] += 1;
        if (branch === "general") p.techLevel = tech.general;
        count += 1;
      }
      if (count > 0) commit(copy);
      return { count, error };
    },
    upgradeBank: () => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const err = mutatePlayer(copy, (p) => {
        const cost = bankUpgradeCost(p.bankLevel);
        if (p.naquadah < cost) return "Not enough Naquadah";
        p.naquadah -= cost;
        p.bankLevel += 1;
        return null;
      });
      if (err) return err;
      commit(copy);
      return null;
    },
    upgradeMothership: () => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const err = mutatePlayer(copy, (p) => {
        const next = (p.mothership?.tier ?? 0) + 1;
        if (next > MOTHERSHIP_MAX_TIER) return "Mothership already at max tier";
        const cost = mothershipUpgradeCost(p.mothership?.tier ?? 0);
        if (p.naquadah < cost) return "Not enough Naquadah";
        p.naquadah -= cost;
        const prevParts = p.mothership?.parts;
        p.mothership = mothershipStats(next, prevParts);
        return null;
      });
      if (err) return err;
      commit(copy);
      return null;
    },
    upgradeMothershipMax: (limit = 12) => {
      if (!save) return { count: 0, error: "No save" };
      const copy = structuredClone(save);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return { count: 0, error: "No player" };
      let count = 0;
      let error: string | null = null;
      for (let i = 0; i < limit; i++) {
        const tier = p.mothership?.tier ?? 0;
        if (tier >= MOTHERSHIP_MAX_TIER) {
          error = count === 0 ? "Mothership already at max tier" : null;
          break;
        }
        const cost = mothershipUpgradeCost(tier);
        if (p.naquadah < cost) {
          error = count === 0 ? "Not enough Naquadah" : null;
          break;
        }
        p.naquadah -= cost;
        p.mothership = mothershipStats(tier + 1, p.mothership?.parts);
        count += 1;
      }
      if (count > 0) commit(copy);
      return { count, error };
    },
    upgradeMothershipPart: (part) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        upgradeMothershipPart(p, part);
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Part upgrade failed";
      }
    },
    upgradeMothershipPartMax: (part, limit = 40) => {
      if (!save) return { count: 0, error: "No save" };
      const copy = structuredClone(save);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return { count: 0, error: "No player" };
      let count = 0;
      let error: string | null = null;
      for (let i = 0; i < limit; i++) {
        try {
          upgradeMothershipPart(p, part);
          count += 1;
        } catch (e) {
          error =
            count === 0
              ? e instanceof Error
                ? e.message
                : "Part upgrade failed"
              : null;
          break;
        }
      }
      if (count > 0) commit(copy);
      return { count, error };
    },
    expandMothershipCapacity: (kind) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        expandMothershipCapacity(p, kind);
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Capacity expand failed";
      }
    },
    expandMothershipCapacityMax: (kind, limit = 100) => {
      if (!save) return { count: 0, error: "No save" };
      const copy = structuredClone(save);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return { count: 0, error: "No player" };
      let count = 0;
      let error: string | null = null;
      for (let i = 0; i < limit; i++) {
        try {
          expandMothershipCapacity(p, kind);
          count += 1;
        } catch (e) {
          error =
            count === 0
              ? e instanceof Error
                ? e.message
                : "Capacity expand failed"
              : null;
          break;
        }
      }
      if (count > 0) commit(copy);
      return { count, error };
    },
    installMothershipArmament: (kind, qty = 1) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        installMothershipArmament(p, kind, qty);
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Armament install failed";
      }
    },
    installMothershipArmamentMax: (kind) => {
      if (!save) return { count: 0, error: "No save" };
      const copy = structuredClone(save);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return { count: 0, error: "No player" };
      const ms = p.mothership;
      if (!ms || ms.tier < 1) {
        return { count: 0, error: "Commission a mothership first" };
      }
      const parts = ensureMothershipParts(ms);
      const fittedKey = kind === "weapons" ? "weapons" : "shields";
      const capKey = kind === "weapons" ? "weaponCapacity" : "shieldCapacity";
      const free = parts[capKey] - parts[fittedKey];
      if (free <= 0) {
        return {
          count: 0,
          error:
            kind === "weapons"
              ? "No free weapon capacity — expand bays first"
              : "No free shield capacity — expand bays first",
        };
      }
      const unit = mothershipArmamentUnitCost(kind);
      const affordable = Math.floor(p.naquadah / unit);
      const qty = Math.min(free, affordable);
      if (qty <= 0) return { count: 0, error: "Not enough Naquadah" };
      try {
        installMothershipArmament(p, kind, qty);
        commit(copy);
        return { count: qty, error: null };
      } catch (e) {
        return {
          count: 0,
          error: e instanceof Error ? e.message : "Armament install failed",
        };
      }
    },
    repairMothership: () => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const err = mutatePlayer(copy, (p) => {
        const ms = p.mothership;
        if (!ms || ms.tier < 1) return "No mothership";
        const missing = ms.maxHull - ms.hull;
        if (missing <= 0) return "Hull already full";
        const cost = Math.ceil(missing * 2.5);
        if (p.naquadah < cost) return "Not enough Naquadah";
        p.naquadah -= cost;
        ms.hull = ms.maxHull;
        return null;
      });
      if (err) return err;
      commit(copy);
      return null;
    },
    buyWeapon: (weaponId, qty) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const err = mutatePlayer(copy, (p) => {
        const w = p.weapons.find((x) => x.id === weaponId);
        if (!w) return "Unknown weapon";
        const tech = ensureTech(p);
        if (tech.equipment < (w.techReq ?? 1)) {
          return `Requires Equipment tech ${w.techReq}`;
        }
        const n = Math.floor(qty);
        if (n < 1) return "Invalid qty";
        const cost = w.buyCost * n;
        if (p.naquadah < cost) return "Not enough Naquadah";
        p.naquadah -= cost;
        w.quantity += n;
        return null;
      });
      if (err) return err;
      commit(copy);
      return null;
    },
    repairWeapon: (weaponId) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const err = mutatePlayer(copy, (p) => {
        const w = p.weapons.find((x) => x.id === weaponId);
        if (!w) return "Unknown weapon";
        const missing = w.maxDurability - w.durability;
        if (missing <= 0) return "Already repaired";
        const cost = Math.ceil(w.buyCost * 0.01 * missing * Math.max(1, w.quantity));
        if (p.naquadah < cost) return "Not enough Naquadah";
        p.naquadah -= cost;
        w.durability = w.maxDurability;
        return null;
      });
      if (err) return err;
      commit(copy);
      return null;
    },
    sellWeapon: (weaponId, qty) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const err = mutatePlayer(copy, (p) => {
        const w = p.weapons.find((x) => x.id === weaponId);
        if (!w) return "Unknown weapon";
        const n = Math.floor(qty);
        if (n < 1 || w.quantity < n) return "Not enough weapons";
        w.quantity -= n;
        p.naquadah += Math.floor(w.buyCost * 0.4 * n);
        return null;
      });
      if (err) return err;
      commit(copy);
      return null;
    },
    deposit: (amount) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const err = mutatePlayer(copy, (p) => {
        const n = Math.floor(amount);
        if (n < 1 || p.naquadah < n) return "Invalid amount";
        const fee = Math.floor(n * depositFeeRate(p.race));
        const net = n - fee;
        const cap = bankCapacity(p, copy.planets ?? []);
        if (p.bankNaquadah + net > cap) return "Bank capacity exceeded";
        p.naquadah -= n;
        p.bankNaquadah += net;
        return null;
      });
      if (err) return err;
      commit(copy);
      return null;
    },
    withdraw: (amount) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const err = mutatePlayer(copy, (p) => {
        const n = Math.floor(amount);
        if (n < 1 || p.bankNaquadah < n) return "Invalid amount";
        p.bankNaquadah -= n;
        p.naquadah += n;
        return null;
      });
      if (err) return err;
      commit(copy);
      return null;
    },
    attack: (targetId, turns, kind = "attack") => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      if (!copy.logs) copy.logs = { attacks: [], intelligence: [] };
      if (!copy.logs.attacks) copy.logs.attacks = [];
      const atk = copy.realms.find((r) => r.id === copy.playerId);
      const def = copy.realms.find((r) => r.id === targetId);
      if (!atk || !def) return "Invalid target";
      try {
        const { log } = resolveAttack(
          atk,
          def,
          turns,
          kind,
          copy.planets ?? [],
          copy,
        );
        copy.logs.attacks.unshift(log);
        commit(copy);
        return log;
      } catch (e) {
        return e instanceof Error ? e.message : "Attack failed";
      }
    },
    eradicate: (targetId) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      if (!copy.logs) copy.logs = { attacks: [], intelligence: [] };
      if (!copy.logs.attacks) copy.logs.attacks = [];
      const atk = copy.realms.find((r) => r.id === copy.playerId);
      const def = copy.realms.find((r) => r.id === targetId);
      if (!atk || !def) return "Invalid target";
      try {
        const { log } = resolveEradication(
          atk,
          def,
          copy.planets ?? [],
          copy,
        );
        copy.logs.attacks.unshift(log);
        commit(copy);
        return log;
      } catch (e) {
        return e instanceof Error ? e.message : "Eradication failed";
      }
    },
    conquerPlanet: (planetId) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const atk = copy.realms.find((r) => r.id === copy.playerId);
      const planet = (copy.planets ?? []).find((p) => p.id === planetId);
      if (!atk || !planet) return "Invalid planet";
      try {
        const log = resolvePlanetConquer(atk, planet, copy.planets ?? []);
        copy.logs.attacks.unshift(log);
        commit(copy);
        return log;
      } catch (e) {
        return e instanceof Error ? e.message : "Conquer failed";
      }
    },
    createGuild: (name) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      if (!copy.alliances) copy.alliances = [];
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        createAlliance(copy, p, name);
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Could not create guild";
      }
    },
    joinGuild: (allianceId) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        joinAlliance(copy, p, allianceId);
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Could not join guild";
      }
    },
    leaveGuild: () => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      leaveAlliance(copy, p);
      commit(copy);
      return null;
    },
    startFleetCluster: () => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        startFleetCluster(copy, p);
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Could not start fleet cluster";
      }
    },
    joinFleetCluster: (clusterId) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        joinFleetCluster(copy, p, clusterId);
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Could not join fleet cluster";
      }
    },
    leaveFleetCluster: () => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        leaveFleetCluster(copy, p);
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Could not leave fleet cluster";
      }
    },
    kickFromFleetCluster: (realmId) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        kickFromFleetCluster(copy, p, realmId);
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Could not kick from cluster";
      }
    },
    dissolveFleetCluster: () => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        dissolveFleetCluster(copy, p);
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Could not dissolve cluster";
      }
    },
    declareWar: (targetAllianceId) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      if (!copy.wars) copy.wars = [];
      if (!copy.news) copy.news = [];
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        declareGuildWar(copy, p, targetAllianceId);
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Could not declare war";
      }
    },
    endWar: (warId) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      if (!copy.wars) copy.wars = [];
      if (!copy.news) copy.news = [];
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        endGuildWarByLeader(copy, p, warId);
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Could not end war";
      }
    },
    upgradeGuildTechBranch: (branch) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        upgradeGuildTech(copy, p, branch);
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Could not upgrade guild tech";
      }
    },
    depositGuildFund: (amount) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        depositGuildFund(copy, p, amount);
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Could not deposit";
      }
    },
    withdrawGuildFund: (amount) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        withdrawGuildFund(copy, p, amount);
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Could not withdraw";
      }
    },
    requestDonation: (opts) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      if (!copy.contracts) copy.contracts = [];
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        createDonationRequest(copy, p, opts);
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Could not post request";
      }
    },
    fulfillDonation: (contractId) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        fulfillDonationRequest(copy, p, contractId);
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Could not fulfill";
      }
    },
    cancelDonation: (contractId) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        cancelDonationRequest(copy, p, contractId);
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Could not cancel";
      }
    },
    declineDonation: (contractId) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        declineDonationRequest(copy, p, contractId);
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Could not decline";
      }
    },
    marketTrade: (opts) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      if (!copy.market) {
        copy.market = {
          inventory: { untrained: 800, attackTurns: 40 },
          recentSells: { untrained: 0, attackTurns: 0 },
          lastDecayAt: Date.now(),
          trades: [],
          priceHistory: [],
        };
      }
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        executeMarketTrade(copy, p, opts);
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Trade failed";
      }
    },
    postForum: (channel, body) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      ensureForum(copy);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        createForumPost(copy, p, { channel, body, isAi: false });
        // Allow AI replies soon after a player post (don't wait full cooldown)
        ensureForum(copy).lastAiChatAt = Date.now() - AI_FORUM_COOLDOWN_MS + 6_000;
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Could not post";
      }
    },
    pulseForumAi: async (force = false) => {
      if (!save) return { posted: 0, error: "No save" };
      if (save.settings.aiEnabled === false) {
        return { posted: 0, error: "AI is disabled in settings" };
      }
      const forum = ensureForum(save);
      const now = Date.now();
      if (
        !force &&
        forum.lastAiChatAt &&
        now - forum.lastAiChatAt < AI_FORUM_COOLDOWN_MS
      ) {
        const wait = Math.ceil(
          (AI_FORUM_COOLDOWN_MS - (now - forum.lastAiChatAt)) / 1000,
        );
        return { posted: 0, error: `Cooldown — try again in ${wait}s` };
      }

      const candidates = pickForumReplyCandidates(save, 3);
      if (!candidates.length) {
        return { posted: 0, error: "No AI candidates available" };
      }

      const results = await Promise.all(
        candidates.map(async (c) => {
          const res = await requestForumLlm({
            systemPrompt: c.systemPrompt,
            userPrompt: c.userPrompt,
            ...llmFromSave(save),
          });
          if ("error" in res) return { error: res.error };
          return { candidate: c, text: res.text };
        }),
      );

      const latest = loadGame() ?? save;
      const copy = structuredClone(latest);
      ensureForum(copy);
      let posted = 0;
      let firstError: string | undefined;
      for (const r of results) {
        if (!r || "error" in r) {
          if (r && "error" in r && !firstError) firstError = r.error;
          continue;
        }
        const author = copy.realms.find((x) => x.id === r.candidate.realmId);
        if (!author || author.dead) continue;
        try {
          let body = r.text.trim();
          if (body.length > 500) body = `${body.slice(0, 497)}…`;
          let channel = r.candidate.channel;
          if (channel === "guild") {
            if (
              !author.allianceId ||
              (r.candidate.allianceId &&
                author.allianceId !== r.candidate.allianceId)
            ) {
              channel = "open";
            }
          }
          createForumPost(copy, author, {
            channel,
            body,
            isAi: true,
          });
          posted += 1;
        } catch (e) {
          if (!firstError) {
            firstError = e instanceof Error ? e.message : "Post failed";
          }
        }
      }
      // Only cool down after a successful wave (failed LLM shouldn't lock the button)
      if (posted > 0) ensureForum(copy).lastAiChatAt = Date.now();
      commit(copy);
      return {
        posted,
        error: posted > 0 ? undefined : firstError ?? "LLM returned no usable text",
      };
    },
    sendMail: ({ toId, subject, body }) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      ensureMail(copy);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        startMailThread(copy, p, { toId, subject, body, isAi: false });
        // Nudge AI mail replies soon
        ensureMail(copy).lastAiMailAt =
          Date.now() - AI_MAIL_COOLDOWN_MS + 8_000;
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Could not send mail";
      }
    },
    replyMail: ({ threadId, body }) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      ensureMail(copy);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        replyMailThread(copy, p, { threadId, body, isAi: false });
        ensureMail(copy).lastAiMailAt =
          Date.now() - AI_MAIL_COOLDOWN_MS + 8_000;
        commit(copy);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Could not reply";
      }
    },
    readMailThread: (threadId) => {
      if (!save) return;
      const t = ensureMail(save).threads.find((x) => x.id === threadId);
      if (!t || !t.participantIds.includes(save.playerId)) return;
      const last = t.messages[t.messages.length - 1];
      const nextRead = last?.at ?? Date.now();
      if ((t.lastReadAt[save.playerId] ?? 0) >= nextRead) return;
      const copy = structuredClone(save);
      markThreadRead(copy, copy.playerId, threadId);
      commit(copy);
    },
    pulseMailAi: async (force = false) => {
      if (!save) return { sent: 0, error: "No save" };
      if (save.settings.aiEnabled === false) {
        return { sent: 0, error: "AI is disabled in settings" };
      }
      const mail = ensureMail(save);
      const now = Date.now();
      if (
        !force &&
        mail.lastAiMailAt &&
        now - mail.lastAiMailAt < AI_MAIL_COOLDOWN_MS
      ) {
        const wait = Math.ceil(
          (AI_MAIL_COOLDOWN_MS - (now - mail.lastAiMailAt)) / 1000,
        );
        return { sent: 0, error: `Cooldown — try again in ${wait}s` };
      }

      const candidates = pickAiMailCandidates(save, 3);
      if (!candidates.length) {
        return { sent: 0, error: "No AI mail candidates" };
      }

      const results = await Promise.all(
        candidates.map(async (c) => {
          const res = await requestMailLlm({
            systemPrompt: c.systemPrompt,
            userPrompt: c.userPrompt,
            ...llmFromSave(save),
          });
          if ("error" in res) return { error: res.error as string };
          return { candidate: c, text: res.text };
        }),
      );

      const latest = loadGame() ?? save;
      const copy = structuredClone(latest);
      ensureMail(copy);
      let sent = 0;
      let firstError: string | undefined;
      for (const r of results) {
        if (!r || "error" in r) {
          if (r && "error" in r && !firstError) firstError = r.error;
          continue;
        }
        if (applyAiMailResult(copy, r.candidate, r.text)) sent += 1;
      }
      if (sent > 0) ensureMail(copy).lastAiMailAt = Date.now();
      commit(copy);
      return {
        sent,
        error: sent > 0 ? undefined : firstError ?? "LLM returned no usable mail",
      };
    },
    pulseAiMinds: async (force = false) => {
      if (!save) return { thought: 0, executed: 0, posted: 0, error: "No save" };
      if (
        save.settings.aiEnabled === false &&
        !save.settings.playerAiEnabled
      ) {
        return {
          thought: 0,
          executed: 0,
          posted: 0,
          error: "AI is disabled in settings",
        };
      }
      const candidates = pickThinkCandidates(save, AI_THINK_BATCH, force);
      if (!candidates.length) {
        return {
          thought: 0,
          executed: 0,
          posted: 0,
          error: "No AI minds ready (cooldown)",
        };
      }

      const results = await Promise.all(
        candidates.map(async (c) => {
          const live = save.realms.find((r) => r.id === c.id) ?? c;
          ensureMind(live);
          const res = await requestMindLlm({
            systemPrompt: buildThinkSystemPrompt(),
            userPrompt: [
              buildAiContext(save, live),
              "",
              "Think as this commander. Output JSON only.",
            ].join("\n"),
            maxTokens: 2048,
            ...llmFromSave(save),
          });
          if ("error" in res) return { id: c.id, error: res.error };
          return { id: c.id, text: res.text };
        }),
      );

      const latest = loadGame() ?? save;
      const copy = structuredClone(latest);
      let thought = 0;
      let executed = 0;
      let posted = 0;
      let firstError: string | undefined;
      for (const r of results) {
        if (!r) continue;
        if ("error" in r) {
          if (!firstError) firstError = r.error;
          continue;
        }
        const realm = copy.realms.find((x) => x.id === r.id);
        if (!realm || realm.dead) continue;
        const parsed = parseThinkJson(r.text);
        if (!parsed) {
          pushMemory(realm, "Confused — LLM returned unreadable plan");
          if (!firstError) firstError = "Unreadable LLM JSON";
          continue;
        }
        applyThinkResult(realm, parsed);
        thought += 1;
        executed += executeAiPlan(copy, realm, 5);
        if (parsed.forum?.body) {
          let channel: ForumChannelKind =
            parsed.forum.channel === "guild" ? "guild" : "open";
          if (channel === "guild" && !realm.allianceId) channel = "open";
          try {
            createForumPost(copy, realm, {
              channel,
              body: String(parsed.forum.body).slice(0, 500),
              isAi: true,
            });
            posted += 1;
          } catch (e) {
            if (!firstError) {
              firstError = e instanceof Error ? e.message : "Forum failed";
            }
          }
        }
      }
      if (thought > 0 || posted > 0) {
        ensureForum(copy).lastAiChatAt = Date.now();
      }
      commit(copy);
      return {
        thought,
        executed,
        posted,
        error:
          thought > 0
            ? undefined
            : firstError ?? "LLM returned no usable minds",
      };
    },
    setFaction: (factionId: FactionId) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const err = mutatePlayer(copy, (p) => {
        if (p.allianceId) {
          return "Leave your guild before changing faction (guild sets faction)";
        }
        p.factionId = factionId;
        return null;
      });
      if (err) return err;
      commit(copy);
      return null;
    },
    spy: (targetId, agents) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const actor = copy.realms.find((r) => r.id === copy.playerId);
      const target = copy.realms.find((r) => r.id === targetId);
      if (!actor || !target) return "Invalid target";
      try {
        const { log } = resolveSpy(actor, target, agents);
        copy.logs.intelligence.unshift(log);
        commit(copy);
        return log;
      } catch (e) {
        return e instanceof Error ? e.message : "Spy failed";
      }
    },
    sabotage: (targetId, agents) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const actor = copy.realms.find((r) => r.id === copy.playerId);
      const target = copy.realms.find((r) => r.id === targetId);
      if (!actor || !target) return "Invalid target";
      try {
        const { log } = resolveSabotage(actor, target, agents);
        copy.logs.intelligence.unshift(log);
        commit(copy);
        return log;
      } catch (e) {
        return e instanceof Error ? e.message : "Sabotage failed";
      }
    },
    assassinate: (targetId, agents) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const actor = copy.realms.find((r) => r.id === copy.playerId);
      const target = copy.realms.find((r) => r.id === targetId);
      if (!actor || !target) return "Invalid target";
      try {
        const { log } = resolveAssassinate(actor, target, agents);
        copy.logs.intelligence.unshift(log);
        commit(copy);
        return log;
      } catch (e) {
        return e instanceof Error ? e.message : "Assassinate failed";
      }
    },
    setVacation: (on) => {
      if (!save) return;
      const copy = structuredClone(save);
      mutatePlayer(copy, (p) => {
        p.vacation = on;
        return null;
      });
      commit(copy);
    },
    setTurnMinutes: (m) => {
      if (!save) return;
      const copy = structuredClone(save);
      copy.settings.turnMinutes = Math.max(0.05, m);
      copy.lastTickAt = Date.now();
      commit(copy);
    },
    renamePlayer: (name) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const err = mutatePlayer(copy, (p) => {
        const n = name.trim();
        if (n.length < 2) return "Name too short";
        p.name = n;
        return null;
      });
      if (err) return err;
      commit(copy);
      return null;
    },
    changeRace: (race) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const err = mutatePlayer(copy, (p) => {
        const uu = p.units.untrained;
        const up = p.unitProductionLevel;
        const sl = p.spyLevel;
        const asl = p.antiSpyLevel;
        p.race = race;
        p.techLevel = 1;
        p.tech = { ...DEFAULT_TECH };
        p.bankNaquadah = 0;
        p.mothership = { ...EMPTY_MOTHERSHIP };
        p.units = {
          untrained: uu,
          miners: 0,
          offence: 0,
          defence: 0,
          covert: 0,
          antiCovert: 0,
        };
        p.weapons = starterWeapons(race);
        p.unitProductionLevel = up;
        p.spyLevel = sl;
        p.antiSpyLevel = asl;
        // keep glory / ascension progress across race change
        return null;
      });
      if (err) return err;
      commit(copy);
      return null;
    },
    ascend: () => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const p = copy.realms.find((r) => r.id === copy.playerId);
      if (!p) return "No player";
      try {
        const result = performAscension(p);
        commit(copy);
        return result;
      } catch (e) {
        return e instanceof Error ? e.message : "Ascension failed";
      }
    },
    spendAp: (amount, sink) => {
      if (!save) return "No save";
      const copy = structuredClone(save);
      const err = spendAscensionPoints(copy, copy.playerId, amount, sink);
      if (err) return err;
      commit(copy);
      return null;
    },
    exportJson: () => (save ? exportSaveJson(save) : ""),
    importJson: (json) => {
      try {
        const g = importSaveJson(json);
        catchUpTurns(g, Date.now(), 2);
        catchUpAi(g, Date.now(), 1);
        commit(g);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Import failed";
      }
    },
    getRealm: (id) => save?.realms.find((r) => r.id === id),
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within GameProvider");
  return ctx;
}
