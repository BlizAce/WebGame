export const SCHEMA_VERSION = 23;

export type RaceId = "asgard" | "goauld" | "replicator" | "tauri";

export type FactionId =
  | "gate_coalition"
  | "naq_cartel"
  | "shadow_lattice"
  | "iron_swarm"
  | "unaligned";

export type AllianceJoinMode = "open" | "invite" | "closed";

export type WeaponSlot = "attack" | "defence";

export interface WeaponStack {
  id: string;
  slot: WeaponSlot;
  name: string;
  power: number;
  maxDurability: number;
  durability: number;
  quantity: number;
  buyCost: number;
  /** Minimum equipment tech required to purchase */
  techReq: number;
}

export interface Units {
  untrained: number;
  miners: number;
  offence: number;
  defence: number;
  covert: number;
  antiCovert: number;
}

/** Branching research — each track is permanent. */
export interface TechTree {
  /** General combat multiplier (legacy techLevel) */
  general: number;
  /** Boosts Naq mined by UU / miners / military */
  mining: number;
  /** Offence unit effectiveness */
  offence: number;
  /** Defence unit effectiveness */
  defence: number;
  /** Covert / anti-covert effectiveness */
  covert: number;
  /** Weapon power + unlocks higher gear tiers */
  equipment: number;
}

/** Modular mothership systems — Gate Wars–style capacity + fittings + modules. */
export interface MothershipParts {
  /** Structural plating — max hull */
  hull: number;
  /** Fitted weapon banks (≤ weaponCapacity) */
  weapons: number;
  /** Fitted shield banks (≤ shieldCapacity) */
  shields: number;
  /** Weapon bay slots — expand like classic Gate Wars capacity */
  weaponCapacity: number;
  /** Shield bay slots */
  shieldCapacity: number;
  /** Drive / gate transit — planet conquer edge */
  engines: number;
  /** Sensors / targeting */
  sensors: number;
  /** Fighter bays — flat power + planet support */
  hangar: number;
  /** Power core — multiplies armament contribution */
  reactor: number;
  /** Ablative armor — hull integrity */
  armor: number;
  /** Command bridge — fleet coordination bonus */
  command: number;
}

export type MothershipPartId = keyof MothershipParts;

export interface Mothership {
  tier: number;
  name: string;
  power: number;
  hull: number;
  maxHull: number;
  parts: MothershipParts;
}

export interface Planet {
  id: string;
  name: string;
  ownerId: string | null;
  /** Flat Naq per turn */
  miningYield: number;
  /** Flat UU per turn */
  upYield: number;
  /** Defence rating to conquer */
  defenceRating: number;
  conqueredAt?: number;
}

/** LLM-driven AI personality + working memory + executable plan. */
export type AiPlanAction =
  | "train"
  | "upgrade_up"
  | "upgrade_tech"
  | "upgrade_spy"
  | "upgrade_bank"
  | "buy_weapon"
  | "repair_weapon"
  | "eradicate"
  | "deposit"
  | "withdraw"
  | "market"
  | "attack"
  | "raid"
  | "spy"
  | "sabotage"
  | "forum_open"
  | "forum_guild"
  | "mail"
  | "join_guild"
  | "create_guild"
  | "declare_war"
  | "end_war"
  | "fund_guild_tech"
  | "mothership"
  | "conquer_planet"
  | "ascend"
  | "wait";

export interface AiPlanStep {
  action: AiPlanAction;
  /** Free-form args the executor understands (qty, targetId, commodity, …) */
  args?: Record<string, string | number | boolean>;
  note?: string;
  done?: boolean;
  result?: string;
}

/** How this commander writes on the forum (stable per realm). */
export type AiChatStyle =
  | "roleplay"
  | "min_max"
  | "hothead"
  | "irl_vent"
  | "lurker"
  | "shitposter";

export interface AiMind {
  /** Stable personality blurb the model refines over time */
  persona: string;
  /** Forum / chat voice — roleplay, numbers, IRL venting, etc. */
  chatStyle?: AiChatStyle;
  /** Short-term goals in the AI's own words */
  goals: string[];
  /** Rolling episodic memory of decisions / observations (LLM) */
  memories: string[];
  /**
   * Sliding window of concrete deeds (heuristic + plan execution).
   * Newest first — what this commander actually did recently.
   */
  recentActions?: string[];
  /**
   * Long-term identity document (~1000 tokens max), grown gradually
   * by dedicated soul LLM merges over many sessions.
   */
  soul?: string;
  /** Last soul-file merge timestamp */
  lastSoulAt?: number;
  /** How many times the soul file has been rewritten */
  soulVersion?: number;
  /** Current multi-step plan the brain tries to execute */
  plan: AiPlanStep[];
  planSummary?: string;
  lastThinkAt?: number;
  lastPlanAt?: number;
  thinkCount?: number;
}

export interface Realm {
  id: string;
  name: string;
  race: RaceId;
  isPlayer: boolean;
  naquadah: number;
  bankNaquadah: number;
  bankLevel: number;
  attackTurns: number;
  restedAttackTurns: number;
  covertCapacity: number;
  unitProductionLevel: number;
  spyLevel: number;
  antiSpyLevel: number;
  /** @deprecated use tech.general — kept for migration */
  techLevel: number;
  tech: TechTree;
  units: Units;
  weapons: WeaponStack[];
  mothership: Mothership;
  defenceAlert: number;
  attackFatigue: number;
  vacation: boolean;
  /**
   * Destroyed account — no turns, no AI brain, sits as a dead shell.
   * Living replacements are spawned separately when AI are annihilated.
   */
  dead?: boolean;
  destroyedAt?: number;
  destroyedByName?: string;
  /** Guild / alliance membership */
  allianceId?: string;
  /** Faction allegiance (broad bloc) */
  factionId?: FactionId;
  /** Epoch ms of last successful planet conquer (1/day limit) */
  lastPlanetConquerAt?: number;
  /** Glory & Reputation — earned from high overall rank each turn */
  gloryReputation: number;
  /** Times this realm has ascended */
  ascensionLevel: number;
  /** Banked Ascension Points from sacrifices */
  ascensionPoints: number;
  /** Evolved race title after first ascension (e.g. Tollan) */
  ascendedTitle?: string;
  /** Persistent LLM mind (AI rivals only) */
  mind?: AiMind;
}

/** Same-guild fleet cluster — combined defence when any member is attacked. */
export interface FleetCluster {
  id: string;
  allianceId: string;
  /** Who started / currently leads the cluster */
  leaderId: string;
  /** Living guildmates in the formation (max FLEET_CLUSTER_MAX) */
  memberIds: string[];
  createdAt: number;
}

export interface AttackLogEntry {
  id: string;
  at: number;
  attackerId: string;
  defenderId: string;
  attackerName: string;
  defenderName: string;
  turnsUsed: number;
  won: boolean;
  naqStolen: number;
  uuStolen: number;
  attackerLosses: Partial<Units>;
  defenderLosses: Partial<Units>;
  kind: "attack" | "raid" | "planet" | "eradicate";
  summary: string;
  planetId?: string;
  planetName?: string;
  /** Eradication roll (kill move) when overpowered */
  eradicationAttempted?: boolean;
  eradicationChance?: number;
  eradicated?: boolean;
  /** Fleet cluster defence (when defender was clustered) */
  clusterSize?: number;
  clusterDefence?: number;
}

export interface IntelLogEntry {
  id: string;
  at: number;
  actorId: string;
  targetId: string;
  actorName: string;
  targetName: string;
  kind: "spy" | "sabotage" | "assassinate";
  success: boolean;
  detected: boolean;
  details: string;
  revealed?: Partial<{
    naquadah: number;
    defenceAction: number;
    strikeAction: number;
    units: Units;
    weapons: number;
    mothership: number;
    planets: number;
  }>;
}

export interface GameSettings {
  turnMinutes: number;
  pixelEnabled: boolean;
  soundEnabled: boolean;
  /** How often rival AI pulses fire (1–120). */
  aiPulsesPerHour: number;
  /** How many living AIs act each pulse (round-robin). */
  aiActorsPerPulse: number;
  /**
   * How often to rebuild rankings / power snapshots (minutes).
   * Leaderboards and rank displays read this cache between refreshes.
   */
  rankingsRefreshMinutes: number;
  aiEnabled: boolean;
  /** When true, the player's realm is driven by the AI brain / LLM mind. */
  playerAiEnabled: boolean;
  /** OpenAI-compatible base URL (…/v1). */
  llmBaseUrl: string;
  /** Model id sent to /chat/completions. */
  llmModel: string;
  /** Optional Bearer token; empty uses a local placeholder. */
  llmApiKey: string;
}

/** Denormalized combat scores for one realm (from last rankings refresh). */
export interface RealmRankSnapshot {
  overall: number;
  strike: number;
  defence: number;
  covert: number;
  antiCovert: number;
  mothership: number;
  /** 1-based overall rank among all scored realms at refresh time. */
  overallRank: number;
  /** 1-based G&R leaderboard rank at refresh time. */
  gloryRank: number;
}

export interface GuildRankSnapshot {
  allianceId: string;
  rank: number;
  power: number;
  members: number;
  avgPower: number;
  techUp: number;
  techMining: number;
  leaderName: string;
}

/**
 * Periodic snapshot of commander / guild standings.
 * UI and glory awards read this instead of rescanning 40k realms per action.
 */
export interface RankingsCache {
  refreshedAt: number;
  livingCount: number;
  byId: Record<string, RealmRankSnapshot>;
  order: {
    overall: string[];
    strike: string[];
    defence: string[];
    covert: string[];
    antiCovert: string[];
    mothership: string[];
    glory: string[];
  };
  guilds: GuildRankSnapshot[];
}

export interface GuildTech {
  /** Shared Unit Production bonus for all members */
  up: number;
  /** Shared mining / Naq income bonus for all members */
  mining: number;
}

export type ContractScope = "direct" | "guild" | "faction" | "public";
export type ContractStatus =
  | "open"
  | "fulfilled"
  | "declined"
  | "cancelled"
  | "expired";

/** Request Naq (or aid) from another realm / allies. */
export interface DonationRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  /** Required when scope is direct */
  targetId?: string | null;
  targetName?: string | null;
  scope: ContractScope;
  amount: number;
  message: string;
  status: ContractStatus;
  createdAt: number;
  fulfilledById?: string;
  fulfilledByName?: string;
  fulfilledAt?: number;
}

export interface Alliance {
  id: string;
  name: string;
  tag: string;
  leaderId: string;
  factionId: FactionId;
  joinMode: AllianceJoinMode;
  /** Flat Naq creation cost already paid */
  createdAt: number;
  memberIds: string[];
  news: string[];
  /** Shared research any member can fund */
  tech: GuildTech;
  /** Shared guild treasury — any member may deposit or withdraw */
  fund: number;
}

export type NewsKind =
  | "universe"
  | "attack"
  | "guild"
  | "war"
  | "destruction"
  | "contract"
  | "ascension"
  | "market";

/** Spot-market commodities priced in open Naquadah. */
export type MarketCommodity = "untrained" | "attackTurns";

export type MarketSide = "buy" | "sell";

export interface MarketTrade {
  id: string;
  at: number;
  realmId: string;
  realmName: string;
  commodity: MarketCommodity;
  side: MarketSide;
  quantity: number;
  /** Total Naq paid or received */
  naqTotal: number;
  /** Average Naq per unit for this fill */
  unitPrice: number;
}

/**
 * Open Market state — NPC market-maker with flood-sensitive prices.
 * Higher inventory / recent sells of a commodity → cheaper unit price.
 */
export interface MarketPriceSnapshot {
  at: number;
  prices: Record<MarketCommodity, number>;
}

export interface OpenMarket {
  inventory: Record<MarketCommodity, number>;
  /** Decaying sell pressure (extra dump discount) */
  recentSells: Record<MarketCommodity, number>;
  lastDecayAt: number;
  trades: MarketTrade[];
  /** Mid-price samples for charts (pruned to ~24h) */
  priceHistory: MarketPriceSnapshot[];
  lastSnapshotAt?: number;
}

export interface UniverseNewsEntry {
  id: string;
  at: number;
  kind: NewsKind;
  text: string;
}

export type GuildWarStatus = "active" | "ended";

export interface GuildWar {
  id: string;
  attackerAllianceId: string;
  defenderAllianceId: string;
  attackerTag: string;
  defenderTag: string;
  attackerName: string;
  defenderName: string;
  status: GuildWarStatus;
  declaredAt: number;
  declaredById: string;
  declaredByName: string;
  endedAt?: number;
  killsAttacker: number;
  killsDefender: number;
}

/** Forum channel: public open chat, or a guild-only board. */
export type ForumChannelKind = "open" | "guild";

export interface ForumPost {
  id: string;
  at: number;
  channel: ForumChannelKind;
  /** Required when channel === "guild" */
  allianceId?: string;
  allianceTag?: string;
  authorId: string;
  authorName: string;
  /** True when generated via the LLM endpoint */
  isAi: boolean;
  body: string;
}

export interface ForumState {
  posts: ForumPost[];
  /** Last time we asked the LLM for AI chatter (ms) */
  lastAiChatAt?: number;
}

/** One message inside a private mail thread. */
export interface MailMessage {
  id: string;
  at: number;
  authorId: string;
  authorName: string;
  isAi: boolean;
  body: string;
}

/**
 * Private 1:1 mail thread (email-style). Either participant can reply.
 * participantIds always length 2 (sorted for stable lookup).
 */
export interface MailThread {
  id: string;
  subject: string;
  participantIds: [string, string];
  /** Original sender when the thread was opened */
  starterId: string;
  createdAt: number;
  updatedAt: number;
  messages: MailMessage[];
  /** realmId → last-read timestamp (ms) */
  lastReadAt: Record<string, number>;
}

export interface MailState {
  threads: MailThread[];
  /** Last AI mail generation wave */
  lastAiMailAt?: number;
}

export interface GameSave {
  schemaVersion: number;
  lastTickAt: number;
  lastAiPulseAt: number;
  /** Round-robin index into living AI list for fair pulse batches. */
  aiActorCursor?: number;
  /** Round-robin hint for soul-file merges across the living population. */
  soulUpdateCursor?: number;
  /** Last rankings snapshot rebuild (ms). */
  lastRankingsRefreshAt?: number;
  /** Cached leaderboards / scores — refreshed on rankingsRefreshMinutes. */
  rankingsCache?: RankingsCache;
  playerId: string;
  realms: Realm[];
  planets: Planet[];
  alliances: Alliance[];
  /** Open / recent donation request contracts */
  contracts: DonationRequest[];
  /** Scrolling universe / war / guild ticker */
  news: UniverseNewsEntry[];
  /** Declared guild wars */
  wars: GuildWar[];
  /** Same-guild fleet clusters (combined defence) */
  fleetClusters?: FleetCluster[];
  /** Spot market for UU / attack turns ↔ Naq */
  market: OpenMarket;
  /** Open + guild forum boards */
  forum: ForumState;
  /** Private direct mail between realms */
  mail: MailState;
  logs: {
    attacks: AttackLogEntry[];
    intelligence: IntelLogEntry[];
  };
  settings: GameSettings;
}

export const DEFAULT_FORUM: ForumState = {
  posts: [],
};

export const DEFAULT_MAIL: MailState = {
  threads: [],
};

export const DEFAULT_MARKET: OpenMarket = {
  inventory: { untrained: 800, attackTurns: 40 },
  recentSells: { untrained: 0, attackTurns: 0 },
  lastDecayAt: 0,
  trades: [],
  priceHistory: [],
};

export const DEFAULT_SETTINGS: GameSettings = {
  turnMinutes: 30,
  pixelEnabled: true,
  soundEnabled: false,
  aiPulsesPerHour: 8,
  aiActorsPerPulse: 25,
  rankingsRefreshMinutes: 60,
  aiEnabled: true,
  playerAiEnabled: false,
  llmBaseUrl: "http://100.69.205.67:1234/v1",
  llmModel: "deepseek/deepseek-r1-0528-qwen3-8b",
  llmApiKey: "",
};

export const DEFAULT_TECH: TechTree = {
  general: 1,
  mining: 1,
  offence: 1,
  defence: 1,
  covert: 1,
  equipment: 1,
};

export const DEFAULT_MOTHERSHIP_PARTS: MothershipParts = {
  hull: 0,
  weapons: 0,
  shields: 0,
  weaponCapacity: 0,
  shieldCapacity: 0,
  engines: 0,
  sensors: 0,
  hangar: 0,
  reactor: 0,
  armor: 0,
  command: 0,
};

export const EMPTY_MOTHERSHIP: Mothership = {
  tier: 0,
  name: "None",
  power: 0,
  hull: 0,
  maxHull: 0,
  parts: { ...DEFAULT_MOTHERSHIP_PARTS },
};
