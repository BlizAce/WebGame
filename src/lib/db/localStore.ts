import type { GameSave, Planet, Realm, TechTree, Units } from "@/lib/db/schema";
import {
  DEFAULT_MOTHERSHIP_PARTS,
  DEFAULT_SETTINGS,
  DEFAULT_TECH,
  EMPTY_MOTHERSHIP,
  SCHEMA_VERSION,
} from "@/lib/db/schema";
import { catchUpAi, clampAiActorsPerPulse } from "@/lib/game/ai";
import { catchUpTurns } from "@/lib/game/turns";
import { seedPriceHistoryIfEmpty } from "@/lib/game/market";
import { createGalaxyPlanets } from "@/lib/game/planets";
import { starterWeapons } from "@/lib/game/races";
import { ensureAiPopulation, TARGET_AI_COUNT, dedupeAiNames } from "@/lib/db/seed";
import { compactSave } from "@/lib/db/compactSave";
import { pruneEmptyGuilds } from "@/lib/game/guilds";
import { pruneFleetClusters } from "@/lib/game/fleetClusters";

const BROWSER_SAVE_KEY = "gatewars:save";
const IDB_NAME = "gatewars";
const IDB_STORE = "saves";
const IDB_VERSION = 1;
const SAVE_API = "/api/save";
const PERSIST_DEBOUNCE_MS = 750;

/** In-memory mirror so sync loadGame() / saveGame() stay fast. */
let memorySave: GameSave | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistInFlight: Promise<void> | null = null;
let pendingPersist: GameSave | null = null;

export function isBrowser() {
  return typeof window !== "undefined";
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB open failed"));
  });
}

async function browserIdbGet(): Promise<string | null> {
  if (!isBrowser() || !("indexedDB" in window)) return null;
  try {
    const db = await openIdb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(BROWSER_SAVE_KEY);
      req.onsuccess = () => {
        const v = req.result;
        resolve(typeof v === "string" ? v : v ? JSON.stringify(v) : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function clearBrowserStorage(): Promise<void> {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(BROWSER_SAVE_KEY);
  } catch {
    /* ignore */
  }
  if (!("indexedDB" in window)) return;
  try {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(BROWSER_SAVE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

/** Read leftover browser save (migration only). */
async function loadBrowserLegacy(): Promise<GameSave | null> {
  if (!isBrowser()) return null;
  const fromIdb = await browserIdbGet();
  if (fromIdb) {
    try {
      return JSON.parse(fromIdb) as GameSave;
    } catch {
      /* fall through */
    }
  }
  try {
    const raw = localStorage.getItem(BROWSER_SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as GameSave;
  } catch {
    return null;
  }
}

async function fetchServerSave(): Promise<GameSave | null> {
  try {
    const res = await fetch(SAVE_API, { method: "GET", cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) {
      console.warn("GET /api/save failed", res.status);
      return null;
    }
    return (await res.json()) as GameSave;
  } catch (e) {
    console.warn("GET /api/save error", e);
    return null;
  }
}

async function putServerSave(save: GameSave): Promise<void> {
  const json = JSON.stringify(save);
  const res = await fetch(SAVE_API, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: json,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`PUT /api/save ${res.status}: ${err.slice(0, 200)}`);
  }
}

async function deleteServerSave(): Promise<void> {
  try {
    await fetch(SAVE_API, { method: "DELETE" });
  } catch (e) {
    console.warn("DELETE /api/save failed", e);
  }
}

function schedulePersist(save: GameSave): void {
  if (!isBrowser()) return;
  pendingPersist = save;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushPersist();
  }, PERSIST_DEBOUNCE_MS);
}

async function flushPersist(): Promise<void> {
  if (!pendingPersist) return;
  if (persistInFlight) {
    await persistInFlight;
    if (!pendingPersist) return;
  }
  const snapshot = pendingPersist;
  pendingPersist = null;
  persistInFlight = (async () => {
    try {
      // Avoid structuredClone of 40k realms — compact mutates a shallow copy shell
      const copy = { ...snapshot, realms: snapshot.realms };
      compactSave(copy);
      await putServerSave(copy);
    } catch (e) {
      console.warn("Server save failed", e);
      if (!pendingPersist) pendingPersist = snapshot;
    } finally {
      persistInFlight = null;
    }
  })();
  await persistInFlight;
}

function migrateRealm(realm: Realm): Realm {
  const units = realm.units as Units & { miners?: number };
  if (units.miners == null) units.miners = 0;
  realm.units = units;

  if (!realm.tech) {
    realm.tech = {
      ...DEFAULT_TECH,
      general: realm.techLevel || 1,
    } satisfies TechTree;
  } else {
    realm.tech = { ...DEFAULT_TECH, ...realm.tech };
  }
  realm.techLevel = realm.tech.general;

  if (!realm.mothership) {
    realm.mothership = { ...EMPTY_MOTHERSHIP };
  } else {
    if (!realm.mothership.parts) {
      realm.mothership.parts = { ...DEFAULT_MOTHERSHIP_PARTS };
    } else {
      realm.mothership.parts = {
        ...DEFAULT_MOTHERSHIP_PARTS,
        ...realm.mothership.parts,
      };
      const p = realm.mothership.parts;
      if (p.weaponCapacity < p.weapons) p.weaponCapacity = p.weapons;
      if (p.shieldCapacity < p.shields) p.shieldCapacity = p.shields;
    }
  }

  if (realm.gloryReputation == null) realm.gloryReputation = 0;
  if (realm.ascensionLevel == null) realm.ascensionLevel = 0;
  if (realm.ascensionPoints == null) realm.ascensionPoints = 0;
  if (!realm.factionId) realm.factionId = "unaligned";

  if (realm.isPlayer) {
    const catalog = starterWeapons(realm.race);
    for (const template of catalog) {
      const existing = realm.weapons.find((w) => w.id === template.id);
      if (!existing) {
        realm.weapons.push({ ...template, quantity: 0 });
      } else {
        if (existing.techReq == null) existing.techReq = template.techReq;
        if (!existing.name) existing.name = template.name;
      }
    }
  } else {
    for (const w of realm.weapons ?? []) {
      if (w.techReq == null) w.techReq = 1;
    }
  }

  return realm;
}

export function migrate(save: GameSave): GameSave {
  if (!save.schemaVersion) save.schemaVersion = 1;
  if (save.schemaVersion > SCHEMA_VERSION) {
    console.warn("Save from newer version — loading as-is");
  }

  if (!save.logs) save.logs = { attacks: [], intelligence: [] };

  save.settings = {
    ...DEFAULT_SETTINGS,
    ...save.settings,
    aiPulsesPerHour:
      save.settings?.aiPulsesPerHour ?? DEFAULT_SETTINGS.aiPulsesPerHour,
    aiActorsPerPulse: clampAiActorsPerPulse(
      save.settings?.aiActorsPerPulse ?? DEFAULT_SETTINGS.aiActorsPerPulse,
    ),
    rankingsRefreshMinutes: Math.max(
      1,
      Math.min(
        24 * 60,
        Math.floor(
          save.settings?.rankingsRefreshMinutes ??
            DEFAULT_SETTINGS.rankingsRefreshMinutes,
        ) || DEFAULT_SETTINGS.rankingsRefreshMinutes,
      ),
    ),
    aiEnabled: save.settings?.aiEnabled ?? DEFAULT_SETTINGS.aiEnabled,
    playerAiEnabled:
      save.settings?.playerAiEnabled ?? DEFAULT_SETTINGS.playerAiEnabled,
    llmBaseUrl:
      (save.settings?.llmBaseUrl && String(save.settings.llmBaseUrl).trim()) ||
      DEFAULT_SETTINGS.llmBaseUrl,
    llmModel:
      (save.settings?.llmModel && String(save.settings.llmModel).trim()) ||
      DEFAULT_SETTINGS.llmModel,
    llmApiKey:
      save.settings?.llmApiKey != null
        ? String(save.settings.llmApiKey)
        : DEFAULT_SETTINGS.llmApiKey,
  };

  if (!save.lastAiPulseAt) {
    save.lastAiPulseAt = save.lastTickAt || Date.now();
  }
  if (save.aiActorCursor == null || !Number.isFinite(save.aiActorCursor)) {
    save.aiActorCursor = 0;
  }
  if (save.soulUpdateCursor == null || !Number.isFinite(save.soulUpdateCursor)) {
    save.soulUpdateCursor = 0;
  }
  // Rankings rebuild is async on boot — never sync-score 40k during migrate
  if (save.lastRankingsRefreshAt == null) {
    save.lastRankingsRefreshAt = 0;
  }

  save.realms = (save.realms || []).map(migrateRealm);

  if (!save.planets || save.planets.length === 0) {
    save.planets = createGalaxyPlanets();
  } else {
    save.planets = save.planets.map((p: Planet) => ({
      ...p,
      ownerId: p.ownerId ?? null,
    }));
  }

  ensureAiPopulation(save, TARGET_AI_COUNT);

  if (!save.alliances) save.alliances = [];
  for (const a of save.alliances) {
    if (!a.tech) a.tech = { up: 0, mining: 0 };
    if (a.tech.up == null) a.tech.up = 0;
    if (a.tech.mining == null) a.tech.mining = 0;
    if (a.fund == null || !Number.isFinite(a.fund) || a.fund < 0) a.fund = 0;
  }

  if (!save.contracts) save.contracts = [];
  if (!save.news) save.news = [];
  if (!save.wars) save.wars = [];
  if (!save.fleetClusters) save.fleetClusters = [];
  pruneFleetClusters(save);
  if (!save.forum) save.forum = { posts: [] };
  else if (!save.forum.posts) save.forum.posts = [];
  if (!save.mail) save.mail = { threads: [] };
  else if (!save.mail.threads) save.mail.threads = [];
  if (!save.market) {
    save.market = {
      inventory: { untrained: 800, attackTurns: 40 },
      recentSells: { untrained: 0, attackTurns: 0 },
      lastDecayAt: Date.now(),
      trades: [],
      priceHistory: [],
    };
  } else {
    if (!save.market.inventory) {
      save.market.inventory = { untrained: 800, attackTurns: 40 };
    }
    if (save.market.inventory.untrained == null) {
      save.market.inventory.untrained = 800;
    }
    if (save.market.inventory.attackTurns == null) {
      save.market.inventory.attackTurns = 40;
    }
    if (!save.market.recentSells) {
      save.market.recentSells = { untrained: 0, attackTurns: 0 };
    }
    if (!save.market.trades) save.market.trades = [];
    if (!save.market.priceHistory) save.market.priceHistory = [];
    if (!save.market.lastDecayAt) save.market.lastDecayAt = Date.now();
  }

  seedPriceHistoryIfEmpty(save);

  for (const r of save.realms) {
    if (r.dead == null) r.dead = false;
  }

  dedupeAiNames(save);
  pruneEmptyGuilds(save);

  save.schemaVersion = SCHEMA_VERSION;
  compactSave(save);
  return save;
}

/**
 * Persist to memory immediately; debounce write to server SQLite via /api/save.
 */
export function saveGame(save: GameSave): void {
  save.schemaVersion = SCHEMA_VERSION;
  // Compact only on debounced server flush — not every softCommit/pulse
  memorySave = save;
  if (isBrowser()) schedulePersist(save);
}

/** Sync read — memory first (session), else null until loadGameAsync boots. */
export function loadRaw(): GameSave | null {
  return memorySave;
}

export function loadGame(): GameSave | null {
  const raw = loadRaw();
  if (!raw) return null;
  // Already migrated in-session; avoid re-catchup thrash on every pulse
  return raw;
}

/**
 * Boot path: server SQLite first; if empty, migrate browser legacy once.
 */
export async function loadGameAsync(): Promise<GameSave | null> {
  if (!isBrowser()) return null;
  if (memorySave) return memorySave;

  let raw = await fetchServerSave();
  let migratedFromBrowser = false;

  if (!raw) {
    const legacy = await loadBrowserLegacy();
    if (legacy) {
      raw = legacy;
      migratedFromBrowser = true;
    }
  }

  if (!raw) return null;

  const migrated = migrate(raw);
  // Cap boot catch-up — remaining ticks/pulses finish via the async sim scheduler
  catchUpTurns(migrated, Date.now(), 2);
  catchUpAi(migrated, Date.now(), 1);
  memorySave = migrated;

  // Flush immediately on boot (and after browser migrate)
  try {
    await putServerSave(migrated);
    if (migratedFromBrowser) await clearBrowserStorage();
  } catch (e) {
    console.warn("Initial server persist failed", e);
  }

  return migrated;
}

export function clearGame(): void {
  memorySave = null;
  pendingPersist = null;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (isBrowser()) {
    void deleteServerSave();
    void clearBrowserStorage();
  }
}

export function exportSaveJson(save: GameSave): string {
  const copy = structuredClone(save);
  compactSave(copy);
  return JSON.stringify(copy, null, 2);
}

export function importSaveJson(json: string): GameSave {
  const parsed = JSON.parse(json) as GameSave;
  if (!parsed.realms || !parsed.playerId) {
    throw new Error("Invalid save file");
  }
  const migrated = migrate(parsed);
  memorySave = migrated;
  if (isBrowser()) schedulePersist(migrated);
  return migrated;
}

/** Force any debounced write now (optional; used before unload). */
export async function flushSaveToServer(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  await flushPersist();
}
