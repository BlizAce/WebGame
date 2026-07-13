import type {
  ContractScope,
  DonationRequest,
  GameSave,
  Realm,
} from "@/lib/db/schema";
import { uid } from "@/lib/game/economy";
import { factionOf, getAlliance, sameAlliance, sameFaction } from "@/lib/game/guilds";

export const MAX_OPEN_CONTRACTS_PER_REALM = 2;
export const MAX_CONTRACT_AMOUNT = 500_000;
export const MIN_CONTRACT_AMOUNT = 100;
export const CONTRACT_TTL_MS = 1000 * 60 * 60 * 24 * 3; // 3 days
export const MAX_STORED_CONTRACTS = 120;

export function ensureContracts(save: GameSave): DonationRequest[] {
  if (!save.contracts) save.contracts = [];
  return save.contracts;
}

export function pruneContracts(save: GameSave, now = Date.now()): void {
  const list = ensureContracts(save);
  for (const c of list) {
    if (c.status === "open" && now - c.createdAt > CONTRACT_TTL_MS) {
      c.status = "expired";
    }
  }
  // Keep open + recent closed
  const open = list.filter((c) => c.status === "open");
  const closed = list
    .filter((c) => c.status !== "open")
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_STORED_CONTRACTS - open.length);
  save.contracts = [...open, ...closed].sort((a, b) => b.createdAt - a.createdAt);
}

function openCountFor(save: GameSave, realmId: string): number {
  return ensureContracts(save).filter(
    (c) => c.requesterId === realmId && c.status === "open",
  ).length;
}

export function isEligibleDonor(
  save: GameSave,
  contract: DonationRequest,
  donor: Realm,
): boolean {
  if (contract.status !== "open") return false;
  if (contract.requesterId === donor.id) return false;
  const requester = save.realms.find((r) => r.id === contract.requesterId);
  if (!requester) return false;

  if (contract.scope === "direct") return contract.targetId === donor.id;
  if (contract.scope === "public") return true;
  if (contract.scope === "guild") return sameAlliance(requester, donor);
  if (contract.scope === "faction") {
    return sameFaction(requester, donor) || sameAlliance(requester, donor);
  }
  return false;
}

export function createDonationRequest(
  save: GameSave,
  requester: Realm,
  opts: {
    amount: number;
    message?: string;
    scope: ContractScope;
    targetId?: string | null;
  },
): DonationRequest {
  pruneContracts(save);
  const amount = Math.floor(opts.amount);
  if (amount < MIN_CONTRACT_AMOUNT) {
    throw new Error(`Minimum request is ${MIN_CONTRACT_AMOUNT} Naq`);
  }
  if (amount > MAX_CONTRACT_AMOUNT) {
    throw new Error(`Maximum request is ${MAX_CONTRACT_AMOUNT.toLocaleString()} Naq`);
  }
  if (openCountFor(save, requester.id) >= MAX_OPEN_CONTRACTS_PER_REALM) {
    throw new Error("You already have open donation requests");
  }

  let targetId = opts.targetId ?? null;
  let targetName: string | null = null;
  const scope = opts.scope;

  if (scope === "direct") {
    if (!targetId) throw new Error("Pick a recipient for a direct request");
    const target = save.realms.find((r) => r.id === targetId);
    if (!target) throw new Error("Target not found");
    if (target.id === requester.id) throw new Error("Cannot request from yourself");
    targetName = target.name;
  } else if (scope === "guild") {
    if (!requester.allianceId) throw new Error("Join a guild first");
    if (!getAlliance(save, requester.allianceId)) {
      throw new Error("Guild not found");
    }
  } else if (scope === "faction") {
    if (factionOf(requester) === "unaligned") {
      throw new Error("Join a faction first");
    }
  }

  const contract: DonationRequest = {
    id: uid("contract"),
    requesterId: requester.id,
    requesterName: requester.name,
    targetId,
    targetName,
    scope,
    amount,
    message: (opts.message ?? "").trim().slice(0, 120) || "Requesting aid",
    status: "open",
    createdAt: Date.now(),
  };
  ensureContracts(save).unshift(contract);
  pruneContracts(save);
  return contract;
}

export function fulfillDonationRequest(
  save: GameSave,
  donor: Realm,
  contractId: string,
): DonationRequest {
  pruneContracts(save);
  const contract = ensureContracts(save).find((c) => c.id === contractId);
  if (!contract) throw new Error("Contract not found");
  if (!isEligibleDonor(save, contract, donor)) {
    throw new Error("Not eligible to fulfill this request");
  }
  if (donor.naquadah < contract.amount) {
    throw new Error(`Need ${contract.amount.toLocaleString()} open Naq`);
  }
  const requester = save.realms.find((r) => r.id === contract.requesterId);
  if (!requester) {
    contract.status = "expired";
    throw new Error("Requester no longer exists");
  }

  donor.naquadah -= contract.amount;
  requester.naquadah += contract.amount;
  contract.status = "fulfilled";
  contract.fulfilledById = donor.id;
  contract.fulfilledByName = donor.name;
  contract.fulfilledAt = Date.now();

  const alliance = getAlliance(save, requester.allianceId);
  if (alliance && sameAlliance(requester, donor)) {
    alliance.news.unshift(
      `${donor.name} donated ${contract.amount.toLocaleString()} Naq to ${requester.name}`,
    );
    alliance.news = alliance.news.slice(0, 40);
  }

  return contract;
}

export function cancelDonationRequest(
  save: GameSave,
  actor: Realm,
  contractId: string,
): void {
  const contract = ensureContracts(save).find((c) => c.id === contractId);
  if (!contract) throw new Error("Contract not found");
  if (contract.requesterId !== actor.id) throw new Error("Not your request");
  if (contract.status !== "open") throw new Error("Request is not open");
  contract.status = "cancelled";
}

export function declineDonationRequest(
  save: GameSave,
  actor: Realm,
  contractId: string,
): void {
  const contract = ensureContracts(save).find((c) => c.id === contractId);
  if (!contract) throw new Error("Contract not found");
  if (contract.status !== "open") throw new Error("Request is not open");
  if (contract.scope !== "direct" || contract.targetId !== actor.id) {
    throw new Error("Only the named target can decline");
  }
  contract.status = "declined";
}

export function visibleContractsFor(
  save: GameSave,
  viewer: Realm,
): DonationRequest[] {
  pruneContracts(save);
  return ensureContracts(save).filter((c) => {
    if (c.requesterId === viewer.id) return true;
    if (c.status === "open") return isEligibleDonor(save, c, viewer);
    return (
      c.targetId === viewer.id ||
      c.fulfilledById === viewer.id
    );
  });
}

export function openContractsForDonor(
  save: GameSave,
  donor: Realm,
): DonationRequest[] {
  pruneContracts(save);
  return ensureContracts(save).filter(
    (c) => c.status === "open" && isEligibleDonor(save, c, donor),
  );
}

/** All open public-board contracts (visible to everyone). */
export function openPublicContracts(save: GameSave): DonationRequest[] {
  pruneContracts(save);
  return ensureContracts(save).filter(
    (c) => c.status === "open" && c.scope === "public",
  );
}
