/**
 * Chunked simulation helpers — yield to the browser between batches so
 * navigation and input stay responsive at 40k-realm scale.
 */

import type { GameSave } from "@/lib/db/schema";
import { applyTurn } from "@/lib/game/turns";
import { payGuildFundDividends } from "@/lib/game/guilds";
import { awardGloryForTurn, rankingsCacheStale, refreshRankingsCacheAsync } from "@/lib/game/rankings";
import { clamp } from "@/lib/game/economy";
import { decayMarketPressure } from "@/lib/game/market";
import {
  finalizeAiPulse,
  prepareAiPulse,
  runAiPulse,
  runPreparedAiActor,
  aiPulseIntervalMs,
} from "@/lib/game/ai";

export { catchUpAi } from "@/lib/game/ai";

const REALM_CHUNK = 600;
/** Brains per yield — keep small; each brain does combat/guild/market work. */
const AI_BRAIN_CHUNK = 6;
const MAX_CATCHUP_ASYNC = 48;

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Apply one turn to living realms in chunks, yielding between batches. */
export async function applyTurnChunked(save: GameSave): Promise<void> {
  const realms = save.realms;
  let processed = 0;
  for (let i = 0; i < realms.length; i++) {
    const r = realms[i]!;
    if (r.dead) continue;
    applyTurn(r, save);
    processed += 1;
    if (processed % REALM_CHUNK === 0) await yieldToMain();
  }
  payGuildFundDividends(save);
  await yieldToMain();
  awardGloryForTurn(save);
}

/**
 * Catch up overdue turns without blocking the UI for the full population.
 */
export async function catchUpTurnsAsync(
  save: GameSave,
  now = Date.now(),
  maxTicks = 2,
): Promise<number> {
  const msPerTurn = Math.max(0.05, save.settings.turnMinutes) * 60 * 1000;
  const elapsed = now - save.lastTickAt;
  let ticks = Math.floor(elapsed / msPerTurn);
  ticks = clamp(ticks, 0, Math.min(MAX_CATCHUP_ASYNC, maxTicks));
  for (let i = 0; i < ticks; i++) {
    await applyTurnChunked(save);
    if (i + 1 < ticks) await yieldToMain();
  }
  if (ticks > 0) {
    save.lastTickAt += ticks * msPerTurn;
    decayMarketPressure(save, now);
  }
  return ticks;
}

/** One AI pulse with yields between brain chunks. */
export async function runAiPulseAsync(save: GameSave): Promise<number> {
  const batch = prepareAiPulse(save);
  let acted = 0;

  for (let i = 0; i < batch.actors.length; i++) {
    runPreparedAiActor(save, batch.actors[i]!);
    acted += 1;
    if ((i + 1) % AI_BRAIN_CHUNK === 0) await yieldToMain();
  }

  if (batch.player) {
    runPreparedAiActor(save, batch.player);
    acted += 1;
  }

  finalizeAiPulse(save);
  return acted;
}

/**
 * Catch up overdue AI pulses, yielding inside each pulse and between pulses.
 */
export async function catchUpAiAsync(
  save: GameSave,
  now = Date.now(),
  maxPulses = 1,
): Promise<number> {
  if (
    save.settings.aiEnabled === false &&
    !save.settings.playerAiEnabled
  ) {
    return 0;
  }
  if (!save.lastAiPulseAt) save.lastAiPulseAt = save.lastTickAt || now;

  const interval = aiPulseIntervalMs(save);
  const elapsed = now - save.lastAiPulseAt;
  let pulses = Math.floor(elapsed / interval);
  pulses = clamp(pulses, 0, Math.min(12, maxPulses));
  if (pulses <= 0) return 0;

  for (let i = 0; i < pulses; i++) {
    await runAiPulseAsync(save);
    if (i + 1 < pulses) await yieldToMain();
  }

  save.lastAiPulseAt += pulses * interval;
  if (save.lastAiPulseAt > now) save.lastAiPulseAt = now;
  return pulses;
}

export function runOneAiPulse(save: GameSave): number {
  return runAiPulse(save);
}

/** Rebuild rankings when due (or missing). Returns true if a rebuild ran. */
export async function refreshRankingsIfDueAsync(
  save: GameSave,
  now = Date.now(),
  force = false,
): Promise<boolean> {
  if (!force && !rankingsCacheStale(save, now)) return false;
  await refreshRankingsCacheAsync(save, now);
  return true;
}
