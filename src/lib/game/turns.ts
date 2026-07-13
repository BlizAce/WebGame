import type { GameSave, Realm } from "@/lib/db/schema";
import {
  incomePerTurn,
  uuPerTurn,
  clamp,
  MAX_ATTACK_TURNS,
  ATTACK_TURNS_PER_TICK,
} from "@/lib/game/economy";
import { awardGloryForTurn } from "@/lib/game/rankings";
import { allianceIncomeBonus, guildUpBonus, payGuildFundDividends } from "@/lib/game/guilds";
import { decayMarketPressure } from "@/lib/game/market";

const MAX_CATCHUP = 48;

export function applyTurn(realm: Realm, save: GameSave): void {
  if (realm.vacation || realm.dead) return;

  const planets = save.planets ?? [];
  const social = allianceIncomeBonus(realm, save);
  const guildUu = guildUpBonus(realm, save);
  realm.naquadah += incomePerTurn(realm, planets, social);
  realm.units.untrained += uuPerTurn(realm, planets, guildUu);

  realm.attackTurns = clamp(
    realm.attackTurns + ATTACK_TURNS_PER_TICK,
    0,
    MAX_ATTACK_TURNS,
  );
  realm.restedAttackTurns = clamp(realm.restedAttackTurns + 0.5, 0, 20);
  realm.covertCapacity = clamp(realm.covertCapacity + 1, 0, 20);

  realm.defenceAlert = clamp(realm.defenceAlert - 1.5, 0, 50);
  realm.attackFatigue = clamp(realm.attackFatigue - 1.2, 0, 50);

  if (realm.mothership && realm.mothership.tier > 0) {
    const ms = realm.mothership;
    if (ms.hull < ms.maxHull) {
      ms.hull = Math.min(ms.maxHull, ms.hull + Math.ceil(ms.maxHull * 0.02));
    }
  }
}

export function catchUpTurns(
  save: GameSave,
  now = Date.now(),
  /** Cap ticks per call so UI stays responsive (remaining catch up next tick). */
  maxTicks = MAX_CATCHUP,
): number {
  const msPerTurn = Math.max(0.05, save.settings.turnMinutes) * 60 * 1000;
  const elapsed = now - save.lastTickAt;
  let ticks = Math.floor(elapsed / msPerTurn);
  ticks = clamp(ticks, 0, Math.min(MAX_CATCHUP, maxTicks));
  for (let i = 0; i < ticks; i++) {
    for (const r of save.realms) {
      if (r.dead) continue;
      applyTurn(r, save);
    }
    payGuildFundDividends(save);
    awardGloryForTurn(save);
  }
  if (ticks > 0) {
    save.lastTickAt += ticks * msPerTurn;
    decayMarketPressure(save, now);
  }
  return ticks;
}

export function forceTick(save: GameSave): void {
  for (const r of save.realms) applyTurn(r, save);
  payGuildFundDividends(save);
  awardGloryForTurn(save);
  save.lastTickAt = Date.now();
  decayMarketPressure(save);
}

export function msUntilNextTurn(save: GameSave, now = Date.now()): number {
  const msPerTurn = Math.max(0.05, save.settings.turnMinutes) * 60 * 1000;
  const next = save.lastTickAt + msPerTurn;
  return Math.max(0, next - now);
}
