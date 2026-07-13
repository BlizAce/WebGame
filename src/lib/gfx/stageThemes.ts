export type StageMode =
  | "command"
  | "battle"
  | "armory"
  | "training"
  | "tech"
  | "bank"
  | "guild"
  | "contracts"
  | "rankings"
  | "ascension"
  | "intel"
  | "log"
  | "mothership"
  | "planets"
  | "war"
  | "market"
  | "forum"
  | "mail"
  | "settings";

export const STAGE_CAPTIONS: Record<StageMode, string> = {
  command: "Command lattice — hull scan live",
  battle: "Combat theatre — weapons free",
  armory: "Armory forge — weapon lattice",
  training: "Training yard — personnel vectors",
  tech: "Research core — protocol tree",
  bank: "Vault chamber — Naq containment",
  guild: "Guild nexus — alliance lattice",
  contracts: "Contract board — aid channels",
  rankings: "Rankings array — power spectrum",
  ascension: "Ascension gate — evolved hull field",
  intel: "Intel veil — covert mesh",
  log: "Battle archive — after-action replay",
  mothership: "Drydock — capital systems bay",
  planets: "Orbital map — world annexation",
  war: "War room — guild conflict theatre",
  market: "Open market — flood-priced exchange",
  forum: "Forum net — open & guild channels",
  mail: "Courier net — private dispatches",
  settings: "Systems console — calibration",
};

/** Optional stage subtitle when the player has ascended. */
export function stageHullCaption(ascensionLevel: number): string | null {
  if (ascensionLevel <= 0) return null;
  if (ascensionLevel === 1) return "Mark II hull — first ascension";
  if (ascensionLevel === 2) return "Mark III hull — deep ascension";
  return `Apex hull — Ascension L${ascensionLevel}`;
}
