import type { Planet, Realm } from "@/lib/db/schema";
import {
  covertAction,
  defenceAction,
  formatNaq,
  overallRankScore,
  strikeAction,
} from "@/lib/game/economy";
import { sameAlliance } from "@/lib/game/guilds";

/**
 * GateWars-style ranking / stats visibility.
 *
 * From the classic help:
 * - See Naquadah on rankings: your Covert ≥ 1/5 of theirs
 * - See Army size on rankings: your Covert ≥ 1/3 of theirs
 * - Stats page blanks fields with ???? when covert is too low
 *
 * Extended tiers for combat / detail panels in this build.
 */
export const INTEL_NAQ_RATIO = 1 / 5;
export const INTEL_ARMY_RATIO = 1 / 3;
export const INTEL_COMBAT_RATIO = 1 / 2;
export const INTEL_DETAIL_RATIO = 1;

export type IntelVisibility = {
  /** viewerCovert / targetCovert */
  ratio: number;
  /** Self or same guild — full dossier */
  fullAccess: boolean;
  /** Overall score / rank power */
  seeScore: boolean;
  /** Open Naquadah */
  seeNaquadah: boolean;
  /** Aggregate army size */
  seeArmy: boolean;
  /** Strike / defence action */
  seeCombat: boolean;
  /** Unit breakdown, UP, mothership, G&R, etc. */
  seeDetails: boolean;
};

export function armySize(realm: Realm): number {
  const u = realm.units;
  return (
    (u.untrained ?? 0) +
    (u.miners ?? 0) +
    (u.offence ?? 0) +
    (u.defence ?? 0) +
    (u.covert ?? 0) +
    (u.antiCovert ?? 0)
  );
}

export function intelVisibility(
  viewer: Realm,
  target: Realm,
): IntelVisibility {
  if (viewer.id === target.id || sameAlliance(viewer, target)) {
    return {
      ratio: Infinity,
      fullAccess: true,
      seeScore: true,
      seeNaquadah: true,
      seeArmy: true,
      seeCombat: true,
      seeDetails: true,
    };
  }

  const theirs = Math.max(1, covertAction(target));
  const mine = Math.max(0, covertAction(viewer));
  const ratio = mine / theirs;

  return {
    ratio,
    fullAccess: false,
    seeScore: ratio >= INTEL_NAQ_RATIO,
    seeNaquadah: ratio >= INTEL_NAQ_RATIO,
    seeArmy: ratio >= INTEL_ARMY_RATIO,
    seeCombat: ratio >= INTEL_COMBAT_RATIO,
    seeDetails: ratio >= INTEL_DETAIL_RATIO,
  };
}

export const MASK = "????";

export function maskValue(
  visible: boolean,
  value: string | number,
  format: "raw" | "naq" = "raw",
): string {
  if (!visible) return MASK;
  if (typeof value === "number") {
    return format === "naq" ? formatNaq(value) : String(value);
  }
  return value;
}

export function intelHint(vis: IntelVisibility): string | null {
  if (vis.fullAccess) return null;
  if (vis.seeDetails) return null;
  if (!vis.seeScore) {
    return "Covert too low — dossier sealed (need ≥1/5 their Covert Action).";
  }
  if (!vis.seeArmy) {
    return "Partial scan — raise Covert to ≥1/3 theirs to read army size.";
  }
  if (!vis.seeCombat) {
    return "Partial scan — raise Covert to ≥1/2 theirs to read strike/defence.";
  }
  return "Partial scan — match their Covert Action to unlock full unit detail.";
}

/** Snapshot of what a viewer is allowed to know about a target. */
export function visibleRealmStats(
  viewer: Realm,
  target: Realm,
  planets: Planet[],
  social = 0,
) {
  const vis = intelVisibility(viewer, target);
  const score = overallRankScore(target, planets);
  const strike = strikeAction(target, planets, social);
  const defence = defenceAction(target, planets, social);
  return {
    vis,
    score: maskValue(vis.seeScore, score, "naq"),
    naquadah: maskValue(vis.seeNaquadah, target.naquadah, "naq"),
    army: maskValue(vis.seeArmy, armySize(target), "naq"),
    strike: maskValue(vis.seeCombat, strike, "naq"),
    defence: maskValue(vis.seeCombat, defence, "naq"),
    untrained: maskValue(vis.seeDetails, target.units.untrained, "naq"),
    miners: maskValue(vis.seeDetails, target.units.miners ?? 0, "naq"),
    offence: maskValue(vis.seeDetails, target.units.offence, "naq"),
    defenceUnits: maskValue(vis.seeDetails, target.units.defence, "naq"),
    covert: maskValue(vis.seeDetails, target.units.covert, "naq"),
    antiCovert: maskValue(vis.seeDetails, target.units.antiCovert, "naq"),
    up: maskValue(vis.seeDetails, target.unitProductionLevel),
    glory: maskValue(vis.seeDetails, target.gloryReputation ?? 0, "naq"),
    mothership: vis.seeDetails
      ? (target.mothership?.tier ?? 0) > 0
        ? `T${target.mothership!.tier}`
        : "—"
      : MASK,
    ascension: vis.seeDetails
      ? `L${target.ascensionLevel ?? 0}`
      : MASK,
  };
}
