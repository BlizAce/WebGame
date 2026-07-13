/**
 * Shared realm mutations usable by player GameContext and AI plan execution.
 * All functions mutate in place and return an error string or null on success.
 */
import type {
  GameSave,
  MarketCommodity,
  MarketSide,
  Realm,
  Units,
} from "@/lib/db/schema";
import {
  antiSpyUpgradeCost,
  bankCapacity,
  bankUpgradeCost,
  depositFeeRate,
  ensureTech,
  spyUpgradeCost,
  techBranchCost,
  trainCost,
  upUpgradeCost,
  type TechBranch,
} from "@/lib/game/economy";
import {
  mothershipStats,
  mothershipUpgradeCost,
  MOTHERSHIP_MAX_TIER,
  upgradeMothershipPart,
} from "@/lib/game/mothership";
import type { MothershipPartId } from "@/lib/db/schema";
import { starterWeapons } from "@/lib/game/races";
import { executeMarketTrade } from "@/lib/game/market";
import { resolveAttack, resolveEradication, resolvePlanetConquer } from "@/lib/game/combat";
import {
  resolveAssassinate,
  resolveSabotage,
  resolveSpy,
} from "@/lib/game/covert";
import { createForumPost } from "@/lib/game/forum";
import { startMailThread, replyMailThread } from "@/lib/game/mail";
import {
  createAlliance,
  joinAlliance,
  upgradeGuildTech,
  type GuildTechBranch,
} from "@/lib/game/guilds";
import { declareGuildWar, endGuildWarByLeader } from "@/lib/game/wars";
import {
  performAscension,
  spendAscensionPoints,
} from "@/lib/game/ascension";

export function actionTrain(
  realm: Realm,
  kind: keyof Units,
  amount: number,
): string | null {
  if (kind === "untrained") return "Cannot train into untrained";
  const qty = Math.floor(amount);
  if (qty < 1) return "Invalid amount";
  if (realm.units.untrained < qty) return "Not enough untrained units";
  const cost = trainCost(kind) * qty;
  if (realm.naquadah < cost) return "Not enough Naquadah";
  realm.units.untrained -= qty;
  realm.units[kind] += qty;
  realm.naquadah -= cost;
  return null;
}

export function actionUpgradeUp(realm: Realm): string | null {
  const cost = upUpgradeCost(realm.unitProductionLevel);
  if (realm.naquadah < cost) return "Not enough Naquadah";
  realm.naquadah -= cost;
  realm.unitProductionLevel += 1;
  return null;
}

export function actionUpgradeSpy(realm: Realm): string | null {
  const cost = spyUpgradeCost(realm.spyLevel);
  if (realm.naquadah < cost) return "Not enough Naquadah";
  realm.naquadah -= cost;
  realm.spyLevel += 1;
  return null;
}

export function actionUpgradeAntiSpy(realm: Realm): string | null {
  const cost = antiSpyUpgradeCost(realm.antiSpyLevel);
  if (realm.naquadah < cost) return "Not enough Naquadah";
  realm.naquadah -= cost;
  realm.antiSpyLevel += 1;
  return null;
}

export function actionUpgradeTech(
  realm: Realm,
  branch: TechBranch = "general",
): string | null {
  const tech = ensureTech(realm);
  const cost = techBranchCost(branch, tech[branch]);
  if (realm.naquadah < cost) return "Not enough Naquadah";
  realm.naquadah -= cost;
  tech[branch] += 1;
  realm.techLevel = tech.general;
  return null;
}

export function actionUpgradeBank(realm: Realm): string | null {
  const cost = bankUpgradeCost(realm.bankLevel);
  if (realm.naquadah < cost) return "Not enough Naquadah";
  realm.naquadah -= cost;
  realm.bankLevel += 1;
  return null;
}

export function actionBuyWeapon(
  realm: Realm,
  weaponId: string,
  qty = 1,
): string | null {
  const n = Math.max(1, Math.floor(qty));
  let w = realm.weapons.find((x) => x.id === weaponId);
  if (!w) {
    const catalog = starterWeapons(realm.race);
    const template = catalog.find((x) => x.id === weaponId);
    if (!template) return "Unknown weapon";
    realm.weapons.push({ ...template, quantity: 0 });
    w = realm.weapons.find((x) => x.id === weaponId)!;
  }
  const cost = w.buyCost * n;
  if (realm.naquadah < cost) return "Not enough Naquadah";
  realm.naquadah -= cost;
  w.quantity += n;
  return null;
}

export function actionDeposit(
  save: GameSave,
  realm: Realm,
  amount: number,
): string | null {
  const qty = Math.floor(amount);
  if (qty < 1) return "Invalid amount";
  if (realm.naquadah < qty) return "Not enough open Naq";
  const planets = save.planets ?? [];
  const cap = bankCapacity(realm, planets);
  const room = Math.max(0, cap - realm.bankNaquadah);
  if (room <= 0) return "Vault full";
  const fee = depositFeeRate(realm.race);
  const net = Math.floor(qty * (1 - fee));
  const deposit = Math.min(net, room);
  const gross = fee > 0 ? Math.ceil(deposit / (1 - fee)) : deposit;
  const spend = Math.min(qty, gross);
  const actualNet = Math.floor(spend * (1 - fee));
  realm.naquadah -= spend;
  realm.bankNaquadah += Math.min(actualNet, room);
  return null;
}

export function actionWithdraw(realm: Realm, amount: number): string | null {
  const qty = Math.floor(amount);
  if (qty < 1) return "Invalid amount";
  if (realm.bankNaquadah < qty) return "Not enough banked Naq";
  realm.bankNaquadah -= qty;
  realm.naquadah += qty;
  return null;
}

export function actionUpgradeMothership(realm: Realm): string | null {
  const tier = realm.mothership?.tier ?? 0;
  const next = tier + 1;
  if (next > MOTHERSHIP_MAX_TIER) return "Mothership already at max tier";
  const cost = mothershipUpgradeCost(tier);
  if (realm.naquadah < cost) return "Not enough Naquadah";
  realm.naquadah -= cost;
  const prevParts = realm.mothership?.parts;
  realm.mothership = mothershipStats(next, prevParts);
  return null;
}

export function actionUpgradeMothershipPart(
  realm: Realm,
  part: MothershipPartId,
): string | null {
  try {
    upgradeMothershipPart(realm, part);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Part upgrade failed";
  }
}

export function actionMarket(
  save: GameSave,
  realm: Realm,
  commodity: MarketCommodity,
  side: MarketSide,
  quantity: number,
): string | null {
  try {
    executeMarketTrade(save, realm, { commodity, side, quantity });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Trade failed";
  }
}

export function actionAttack(
  save: GameSave,
  realm: Realm,
  targetId: string,
  turns: number,
  kind: "attack" | "raid" = "attack",
): string | null {
  const target = save.realms.find((r) => r.id === targetId);
  if (!target) return "Target not found";
  try {
    const { log } = resolveAttack(
      realm,
      target,
      turns,
      kind,
      save.planets ?? [],
      save,
    );
    save.logs.attacks.unshift(log);
    save.logs.attacks = save.logs.attacks.slice(0, 400);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Attack failed";
  }
}

export function actionEradicate(
  save: GameSave,
  realm: Realm,
  targetId: string,
): string | null {
  const target = save.realms.find((r) => r.id === targetId);
  if (!target) return "Target not found";
  try {
    const { log } = resolveEradication(
      realm,
      target,
      save.planets ?? [],
      save,
    );
    save.logs.attacks.unshift(log);
    save.logs.attacks = save.logs.attacks.slice(0, 400);
    return log.eradicated ? null : "Eradication roll failed";
  } catch (e) {
    return e instanceof Error ? e.message : "Eradication failed";
  }
}

export function actionCovert(
  save: GameSave,
  realm: Realm,
  targetId: string,
  kind: "spy" | "sabotage" | "assassinate",
  agents: number,
): string | null {
  const target = save.realms.find((r) => r.id === targetId);
  if (!target) return "Target not found";
  try {
    const result =
      kind === "spy"
        ? resolveSpy(realm, target, agents)
        : kind === "sabotage"
          ? resolveSabotage(realm, target, agents)
          : resolveAssassinate(realm, target, agents);
    save.logs.intelligence.unshift(result.log);
    save.logs.intelligence = save.logs.intelligence.slice(0, 200);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Covert failed";
  }
}

export function actionForum(
  save: GameSave,
  realm: Realm,
  channel: "open" | "guild",
  body: string,
  opts?: { isAi?: boolean },
): string | null {
  try {
    createForumPost(save, realm, {
      channel,
      body,
      isAi: opts?.isAi ?? !realm.isPlayer,
    });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Forum post failed";
  }
}

export function actionMail(
  save: GameSave,
  realm: Realm,
  opts: {
    toId?: string;
    threadId?: string;
    subject?: string;
    body: string;
    isAi?: boolean;
  },
): string | null {
  try {
    if (opts.threadId) {
      replyMailThread(save, realm, {
        threadId: opts.threadId,
        body: opts.body,
        isAi: opts.isAi ?? !realm.isPlayer,
      });
      return null;
    }
    if (!opts.toId) return "Missing toId or threadId";
    startMailThread(save, realm, {
      toId: opts.toId,
      subject: opts.subject ?? `Note from ${realm.name}`,
      body: opts.body,
      isAi: opts.isAi ?? !realm.isPlayer,
    });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Mail failed";
  }
}

export function actionCreateGuild(
  save: GameSave,
  realm: Realm,
  name: string,
): string | null {
  try {
    createAlliance(save, realm, name);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Could not create guild";
  }
}

export function actionJoinGuild(
  save: GameSave,
  realm: Realm,
  allianceId: string,
): string | null {
  try {
    joinAlliance(save, realm, allianceId);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Could not join guild";
  }
}

export function actionDeclareWar(
  save: GameSave,
  realm: Realm,
  targetAllianceId: string,
): string | null {
  try {
    declareGuildWar(save, realm, targetAllianceId);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Could not declare war";
  }
}

export function actionEndWar(
  save: GameSave,
  realm: Realm,
  warId: string,
): string | null {
  try {
    endGuildWarByLeader(save, realm, warId);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Could not end war";
  }
}

export function actionFundGuildTech(
  save: GameSave,
  realm: Realm,
  branch: GuildTechBranch = "up",
): string | null {
  try {
    upgradeGuildTech(save, realm, branch);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Guild tech failed";
  }
}

export function actionConquerPlanet(
  save: GameSave,
  realm: Realm,
  planetId: string,
): string | null {
  const planet = (save.planets ?? []).find((p) => p.id === planetId);
  if (!planet) return "Planet not found";
  try {
    const log = resolvePlanetConquer(realm, planet, save.planets ?? []);
    save.logs.attacks.unshift(log);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Conquer failed";
  }
}

export function actionAscend(realm: Realm): string | null {
  try {
    performAscension(realm);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Ascension failed";
  }
}

export function actionSpendAp(
  save: GameSave,
  realm: Realm,
  amount: number,
  sink: "up" | "naq" | "tech",
): string | null {
  return spendAscensionPoints(save, realm.id, amount, sink);
}
