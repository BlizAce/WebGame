import type {
  GameSave,
  MarketCommodity,
  MarketSide,
  MarketTrade,
  OpenMarket,
  Realm,
} from "@/lib/db/schema";
import { DEFAULT_MARKET } from "@/lib/db/schema";
import {
  clamp,
  formatNaq,
  incomePerTurn,
  uid,
  MAX_ATTACK_TURNS,
} from "@/lib/game/economy";
import { pushNews } from "@/lib/game/news";

export const MARKET_COMMODITIES: MarketCommodity[] = [
  "untrained",
  "attackTurns",
];

/** Seed fair mid when the galaxy is still early-game poor. */
export const BASE_PRICE: Record<MarketCommodity, number> = {
  untrained: 18,
  attackTurns: 110,
};

/** Soft inventory where flood ≈ 1.0 at early-game population (pricing only). */
export const BASELINE_INV: Record<MarketCommodity, number> = {
  untrained: 2500,
  attackTurns: 120,
};

/** Floor / ceiling on flood multiplier so prices never go to zero. */
export const FLOOD_MIN = 0.28;
export const FLOOD_MAX = 2.6;

export const MIN_TRADE_QTY = 1;
export const MAX_STORED_TRADES = 80;
/** Half-life of recent-sell pressure (~75 min — clears dumps faster). */
export const SELL_PRESSURE_HALFLIFE_MS = 1000 * 60 * 75;
export const SPREAD = 0.07;

export const COMMODITY_LABEL: Record<MarketCommodity, string> = {
  untrained: "Untrained units",
  attackTurns: "Attack turns",
};

/**
 * Late-game wealth scale so fair prices stay meaningful vs income.
 * Early: ~1×. Mid: tens. Deep late (Q income): up to ~1e5×.
 */
export function economyPriceScale(save: GameSave): number {
  const living = save.realms.filter((r) => !r.dead && !r.vacation);
  if (!living.length) return 1;
  const planets = save.planets ?? [];
  // Sample for speed on huge saves
  const step = Math.max(1, Math.floor(living.length / 60));
  const incomes: number[] = [];
  for (let i = 0; i < living.length; i += step) {
    incomes.push(Math.max(1, incomePerTurn(living[i]!, planets)));
  }
  incomes.sort((a, b) => a - b);
  const med = incomes[Math.floor(incomes.length / 2)] ?? 100;
  // (med/80)^0.42 — smooth growth without instantly hitting the cap
  const raw = Math.pow(med / 80, 0.42);
  return clamp(raw, 1, 250_000);
}

/** Population-aware inventory baseline (more realms → deeper book). */
export function effectiveBaseline(
  save: GameSave,
  commodity: MarketCommodity,
): number {
  const living = save.realms.filter((r) => !r.dead && !r.vacation).length;
  const pop = clamp(living / 80, 1, 18);
  return Math.floor(BASELINE_INV[commodity] * pop);
}

export function fairBasePrice(
  save: GameSave,
  commodity: MarketCommodity,
): number {
  return BASE_PRICE[commodity] * economyPriceScale(save);
}

export function ensureMarket(save: GameSave): OpenMarket {
  if (!save.market) {
    save.market = structuredClone(DEFAULT_MARKET);
    save.market.lastDecayAt = Date.now();
  }
  if (!save.market.inventory) {
    save.market.inventory = { ...DEFAULT_MARKET.inventory };
  }
  if (!save.market.recentSells) {
    save.market.recentSells = { ...DEFAULT_MARKET.recentSells };
  }
  if (!save.market.trades) save.market.trades = [];
  if (!save.market.priceHistory) save.market.priceHistory = [];
  for (const c of MARKET_COMMODITIES) {
    if (!Number.isFinite(save.market.inventory[c]) || save.market.inventory[c] < 0) {
      save.market.inventory[c] = 0;
    }
    if (
      !Number.isFinite(save.market.recentSells[c]) ||
      save.market.recentSells[c] < 0
    ) {
      save.market.recentSells[c] = 0;
    }
  }
  return save.market;
}

export const PRICE_HISTORY_MS = 1000 * 60 * 60 * 24; // 24h
export const SNAPSHOT_INTERVAL_MS = 1000 * 60 * 5; // every 5 min
export const MAX_PRICE_SNAPSHOTS = 72; // ~6h — keeps save size down

/** Record mid prices for charts; throttled + pruned to 24h. */
export function recordMarketSnapshot(save: GameSave, now = Date.now()): void {
  const m = ensureMarket(save);
  if (m.lastSnapshotAt && now - m.lastSnapshotAt < SNAPSHOT_INTERVAL_MS) {
    return;
  }
  const prices = {} as Record<MarketCommodity, number>;
  for (const c of MARKET_COMMODITIES) {
    prices[c] = midPrice(save, c);
  }
  m.priceHistory.push({ at: now, prices });
  m.lastSnapshotAt = now;
  const cutoff = now - PRICE_HISTORY_MS;
  m.priceHistory = m.priceHistory
    .filter((s) => s.at >= cutoff)
    .slice(-MAX_PRICE_SNAPSHOTS);
}

/**
 * Seed a flat 24h history so charts aren't empty on first load / migration.
 */
export function seedPriceHistoryIfEmpty(save: GameSave, now = Date.now()): void {
  const m = ensureMarket(save);
  if (m.priceHistory.length > 0) return;
  const step = SNAPSHOT_INTERVAL_MS;
  const points = Math.floor(PRICE_HISTORY_MS / step);
  for (let i = points; i >= 0; i--) {
    const at = now - i * step;
    const prices = {} as Record<MarketCommodity, number>;
    for (const c of MARKET_COMMODITIES) {
      const mid = midPrice(save, c);
      const wobble =
        1 + Math.sin(i * 0.35 + (c === "untrained" ? 0 : 1.2)) * 0.06;
      prices[c] = mid * wobble;
    }
    m.priceHistory.push({ at, prices });
  }
  m.lastSnapshotAt = now;
}

export function decayMarketPressure(save: GameSave, now = Date.now()): void {
  const m = ensureMarket(save);
  if (!m.lastDecayAt) m.lastDecayAt = now;
  const elapsed = Math.max(0, now - m.lastDecayAt);
  if (elapsed < 20_000) {
    recordMarketSnapshot(save, now);
    return;
  }
  const steps = elapsed / SELL_PRESSURE_HALFLIFE_MS;
  const factor = Math.pow(0.5, steps);
  for (const c of MARKET_COMMODITIES) {
    // Only recent-sell pressure decays — book inventory is uncapped and permanent.
    m.recentSells[c] = Math.floor(m.recentSells[c] * factor);
  }
  m.lastDecayAt = now;
  recordMarketSnapshot(save, now);
}

/**
 * Mid price multiplier from flood. Log pressure so mega-dumps can't zero the book.
 */
export function floodMultiplier(
  market: OpenMarket,
  commodity: MarketCommodity,
  baseline: number,
): number {
  const inv = Math.max(0, market.inventory[commodity]);
  const recent = Math.max(0, market.recentSells[commodity]);
  const base = Math.max(1, baseline);
  const pressure =
    Math.log2(1 + inv / base) + Math.log2(1 + recent / (base * 0.55));
  // ~1.55 at empty, ~1.0 near baseline, soft floor when flooded
  const raw = Math.pow(1.32, -pressure) * 1.55;
  return clamp(raw, FLOOD_MIN, FLOOD_MAX);
}

export function midPrice(
  save: GameSave,
  commodity: MarketCommodity,
  market?: OpenMarket,
): number {
  const m = market ?? ensureMarket(save);
  const base = effectiveBaseline(save, commodity);
  return fairBasePrice(save, commodity) * floodMultiplier(m, commodity, base);
}

export function quoteUnitPrice(
  save: GameSave,
  commodity: MarketCommodity,
  side: MarketSide,
  market?: OpenMarket,
): number {
  const mid = midPrice(save, commodity, market);
  return side === "buy" ? mid * (1 + SPREAD / 2) : mid * (1 - SPREAD / 2);
}

/**
 * Progressive fill: each chunk of the order moves inventory, so large dumps
 * get worse average prices (flood mid-trade).
 */
export function quoteTrade(
  save: GameSave,
  commodity: MarketCommodity,
  side: MarketSide,
  quantity: number,
): { naqTotal: number; unitPrice: number; ok: boolean; reason?: string } {
  const market = ensureMarket(save);
  const qty = Math.floor(quantity);
  if (qty < MIN_TRADE_QTY) {
    return { naqTotal: 0, unitPrice: 0, ok: false, reason: "Quantity too small" };
  }
  if (!Number.isFinite(qty)) {
    return { naqTotal: 0, unitPrice: 0, ok: false, reason: "Invalid quantity" };
  }

  const scratch: OpenMarket = {
    inventory: { ...market.inventory },
    recentSells: { ...market.recentSells },
    lastDecayAt: market.lastDecayAt,
    trades: [],
    priceHistory: [],
  };

  let naqTotal = 0;
  // Cap chunk count so huge orders stay cheap to quote
  const chunk = Math.max(1, Math.ceil(qty / 24));
  let left = qty;

  while (left > 0) {
    const n = Math.min(chunk, left);
    const unit = quoteUnitPrice(save, commodity, side, scratch);
    naqTotal += unit * n;
    if (side === "sell") {
      scratch.inventory[commodity] += n;
      scratch.recentSells[commodity] += n;
    } else {
      scratch.inventory[commodity] = Math.max(
        0,
        scratch.inventory[commodity] - n,
      );
    }
    left -= n;
  }

  naqTotal = Math.floor(naqTotal);
  if (naqTotal < 1 && qty > 0) {
    // Should be rare with FLOOD_MIN — bump to at least 1 Naq/unit floor * qty
    const floorUnit = Math.max(
      1,
      Math.floor(fairBasePrice(save, commodity) * FLOOD_MIN * 0.9),
    );
    naqTotal = floorUnit * qty;
  }
  return {
    naqTotal,
    unitPrice: naqTotal / qty,
    ok: true,
  };
}

function applyInventory(
  _save: GameSave,
  market: OpenMarket,
  commodity: MarketCommodity,
  side: MarketSide,
  quantity: number,
): void {
  if (side === "sell") {
    market.inventory[commodity] += quantity;
    market.recentSells[commodity] += quantity;
  } else {
    market.inventory[commodity] = Math.max(
      0,
      market.inventory[commodity] - quantity,
    );
  }
}

function realmHasCommodity(realm: Realm, commodity: MarketCommodity): number {
  if (commodity === "untrained") return Math.floor(realm.units.untrained);
  return Math.floor(realm.attackTurns);
}

function takeCommodity(
  realm: Realm,
  commodity: MarketCommodity,
  qty: number,
): void {
  if (commodity === "untrained") {
    realm.units.untrained = Math.max(0, realm.units.untrained - qty);
  } else {
    realm.attackTurns = Math.max(0, realm.attackTurns - qty);
  }
}

function giveCommodity(
  realm: Realm,
  commodity: MarketCommodity,
  qty: number,
): void {
  if (commodity === "untrained") {
    realm.units.untrained += qty;
  } else {
    realm.attackTurns = clamp(realm.attackTurns + qty, 0, MAX_ATTACK_TURNS);
  }
}

export function executeMarketTrade(
  save: GameSave,
  realm: Realm,
  opts: {
    commodity: MarketCommodity;
    side: MarketSide;
    quantity: number;
  },
): MarketTrade {
  decayMarketPressure(save);
  const market = ensureMarket(save);
  const commodity = opts.commodity;
  const side = opts.side;
  let qty = Math.floor(opts.quantity);

  if (realm.dead) throw new Error("Destroyed realms cannot trade");
  if (realm.vacation) throw new Error("Vacation mode — market locked");

  if (side === "buy" && commodity === "attackTurns") {
    const room = Math.max(0, MAX_ATTACK_TURNS - Math.floor(realm.attackTurns));
    if (room <= 0) {
      throw new Error(`Attack turns already at cap (${MAX_ATTACK_TURNS})`);
    }
    qty = Math.min(qty, room);
  }

  if (qty < MIN_TRADE_QTY) throw new Error("Nothing to trade");

  const quote = quoteTrade(save, commodity, side, qty);
  if (!quote.ok) throw new Error(quote.reason ?? "Cannot quote");

  if (side === "sell") {
    const have = realmHasCommodity(realm, commodity);
    if (have < qty) {
      throw new Error(
        `Not enough ${COMMODITY_LABEL[commodity].toLowerCase()} (have ${have})`,
      );
    }
    takeCommodity(realm, commodity, qty);
    realm.naquadah += quote.naqTotal;
  } else {
    if (realm.naquadah < quote.naqTotal) {
      throw new Error(
        `Need ${formatNaq(quote.naqTotal)} Naq (have ${formatNaq(realm.naquadah)})`,
      );
    }
    realm.naquadah -= quote.naqTotal;
    giveCommodity(realm, commodity, qty);
  }

  applyInventory(save, market, commodity, side, qty);

  const trade: MarketTrade = {
    id: uid("mkt"),
    at: Date.now(),
    realmId: realm.id,
    realmName: realm.name,
    commodity,
    side,
    quantity: qty,
    naqTotal: quote.naqTotal,
    unitPrice: quote.unitPrice,
  };

  market.trades = [trade, ...market.trades].slice(0, MAX_STORED_TRADES);
  recordMarketSnapshot(save);

  if (qty >= (commodity === "untrained" ? 200 : 8) || quote.naqTotal >= 5000) {
    const verb = side === "sell" ? "dumped" : "scooped";
    pushNews(
      save,
      "market",
      `${realm.name} ${verb} ${qty} ${COMMODITY_LABEL[commodity].toLowerCase()} on the Open Market (${formatNaq(quote.naqTotal)} Naq).`,
    );
  }

  return trade;
}

export function marketBoard(save: GameSave): {
  commodity: MarketCommodity;
  label: string;
  mid: number;
  buy: number;
  sell: number;
  fair: number;
  inventory: number;
  recentSells: number;
  flood: number;
  baseline: number;
}[] {
  const m = ensureMarket(save);
  return MARKET_COMMODITIES.map((commodity) => {
    const baseline = effectiveBaseline(save, commodity);
    return {
      commodity,
      label: COMMODITY_LABEL[commodity],
      mid: midPrice(save, commodity),
      buy: quoteUnitPrice(save, commodity, "buy"),
      sell: quoteUnitPrice(save, commodity, "sell"),
      fair: fairBasePrice(save, commodity),
      inventory: m.inventory[commodity],
      recentSells: m.recentSells[commodity],
      flood: floodMultiplier(m, commodity, baseline),
      baseline,
    };
  });
}

export type GalaxyResourceStats = {
  livingRealms: number;
  deadRealms: number;
  openNaq: number;
  bankNaq: number;
  totalNaq: number;
  marketNaqEstimate: number;
  untrained: number;
  miners: number;
  offence: number;
  defence: number;
  covert: number;
  antiCovert: number;
  totalUnits: number;
  attackTurns: number;
  planets: number;
  weapons: number;
  marketInventory: Record<MarketCommodity, number>;
  marketRecentSells: Record<MarketCommodity, number>;
};

/** Aggregate open-economy totals across all realms + market book. */
export function galaxyResourceStats(save: GameSave): GalaxyResourceStats {
  const market = ensureMarket(save);
  let openNaq = 0;
  let bankNaq = 0;
  let untrained = 0;
  let miners = 0;
  let offence = 0;
  let defence = 0;
  let covert = 0;
  let antiCovert = 0;
  let attackTurns = 0;
  let weapons = 0;
  let livingRealms = 0;
  let deadRealms = 0;

  for (const r of save.realms) {
    if (r.dead) {
      deadRealms += 1;
      continue;
    }
    livingRealms += 1;
    openNaq += Math.max(0, r.naquadah);
    bankNaq += Math.max(0, r.bankNaquadah);
    untrained += Math.max(0, r.units.untrained);
    miners += Math.max(0, r.units.miners);
    offence += Math.max(0, r.units.offence);
    defence += Math.max(0, r.units.defence);
    covert += Math.max(0, r.units.covert);
    antiCovert += Math.max(0, r.units.antiCovert);
    attackTurns += Math.max(0, r.attackTurns);
    for (const w of r.weapons) {
      weapons += Math.max(0, w.quantity ?? 0);
    }
  }

  const planets = (save.planets ?? []).length;
  const totalUnits =
    untrained + miners + offence + defence + covert + antiCovert;

  // Rough Naq locked in the book at current mid (not spendable — informational)
  let marketNaqEstimate = 0;
  for (const c of MARKET_COMMODITIES) {
    marketNaqEstimate += market.inventory[c] * midPrice(save, c, market);
  }

  return {
    livingRealms,
    deadRealms,
    openNaq,
    bankNaq,
    totalNaq: openNaq + bankNaq,
    marketNaqEstimate: Math.floor(marketNaqEstimate),
    untrained,
    miners,
    offence,
    defence,
    covert,
    antiCovert,
    totalUnits,
    attackTurns: Math.floor(attackTurns),
    planets,
    weapons,
    marketInventory: { ...market.inventory },
    marketRecentSells: { ...market.recentSells },
  };
}
