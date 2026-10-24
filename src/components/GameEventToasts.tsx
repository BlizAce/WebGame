"use client";

/**
 * Bridges game-state changes to toast notifications.
 *
 * Deliberately diff-based rather than wired into every action: the simulation
 * also advances while the player is idle or on another screen, so watching
 * derived state (log entries, unread mail, rank, life status) catches events no
 * page handler would ever see.
 *
 * Events are selected by timestamp against a baseline captured on first load,
 * not by comparing "the newest id" — one AI pulse can prepend dozens of log rows
 * in a single commit, and an id comparison would drop every player event that
 * was not the very latest row. Baselining also stops a fresh page load from
 * replaying history as a burst of notifications.
 */
import { useEffect, useRef } from "react";
import { useGame } from "@/lib/game/GameContext";
import { pushToast } from "@/lib/ui/toast";
import { formatNaq } from "@/lib/game/economy";

/** Cap per sweep so a busy pulse cannot bury the screen in notifications. */
const MAX_EVENTS_PER_SWEEP = 2;

type Baseline = {
  /** newest attack-log timestamp already accounted for (0 = none seen) */
  attackAt: number;
  /** newest intel-log timestamp already accounted for */
  intelAt: number;
  mailUnread: number;
  overallRank: number | null;
  dead: boolean;
  ascensionLevel: number;
};

export function GameEventToasts() {
  const { player, save, ready, mailUnread } = useGame();
  const base = useRef<Baseline | null>(null);

  useEffect(() => {
    if (!ready || !player || !save) return;

    const attacks = save.logs?.attacks ?? [];
    const intel = save.logs?.intelligence ?? [];
    const rank = save.rankingsCache?.byId[player.id]?.overallRank ?? null;
    const dead = !!player.dead;
    const ascensionLevel = player.ascensionLevel ?? 0;

    // Newest-first convention; max() keeps this correct if that ever changes.
    const newestAt = (entries: { at: number }[]) =>
      entries.reduce((m, e) => (e.at > m ? e.at : m), 0);
    const attackAt = newestAt(attacks);
    const intelAt = newestAt(intel);

    // First pass after load: record where we started, notify about nothing.
    if (base.current === null) {
      base.current = {
        attackAt,
        intelAt,
        mailUnread,
        overallRank: rank,
        dead,
        ascensionLevel,
      };
      return;
    }
    const prev = base.current;
    let raised = 0;

    // --- combat involving this realm --------------------------------------
    if (attackAt > prev.attackAt && raised < MAX_EVENTS_PER_SWEEP) {
      // Oldest-to-newest so the most recent event wins the top of the stack.
      const fresh = attacks
        .filter(
          (a) =>
            a.at > prev.attackAt &&
            (a.attackerId === player.id || a.defenderId === player.id),
        )
        .sort((u, v) => u.at - v.at);

      for (const entry of fresh) {
        if (raised >= MAX_EVENTS_PER_SWEEP) break;
        raised++;
        const againstMe = entry.defenderId === player.id;
        if (againstMe) {
          pushToast({
            kind: entry.won ? "warn" : "success",
            title: entry.won
              ? `${entry.attackerName} raided you`
              : `You repelled ${entry.attackerName}`,
            body: entry.won
              ? `They took ${formatNaq(entry.naqStolen ?? 0)} Naquadah · see Attack Log`
              : `Defended against ${entry.turnsUsed} turn(s) of assault`,
            ttl: 8000,
          });
        } else {
          pushToast({
            kind: entry.won ? "success" : "danger",
            title: entry.won
              ? `Attack on ${entry.defenderName} succeeded`
              : `Attack on ${entry.defenderName} failed`,
            body: entry.won
              ? `Plundered ${formatNaq(entry.naqStolen ?? 0)} Naquadah`
              : "No spoils — check the Attack Log",
            ttl: 8000,
          });
        }
      }
    }

    // --- intelligence you gathered ----------------------------------------
    if (intelAt > prev.intelAt && raised < MAX_EVENTS_PER_SWEEP) {
      // Intel rows use actorId (the spy), not attackerId.
      const fresh = intel
        .filter((i) => i.at > prev.intelAt && i.actorId === player.id)
        .sort((u, v) => u.at - v.at);
      for (const entry of fresh) {
        if (raised >= MAX_EVENTS_PER_SWEEP) break;
        raised++;
        pushToast({
          kind: entry.success ? "info" : "warn",
          title: entry.success
            ? `${entry.kind === "spy" ? "Intelligence" : entry.kind} on ${entry.targetName} succeeded`
            : `${entry.kind} on ${entry.targetName} failed`,
          body: entry.detected ? "You were detected" : undefined,
          ttl: 6000,
        });
      }
    }

    // --- mail --------------------------------------------------------------
    if (mailUnread > prev.mailUnread && raised < MAX_EVENTS_PER_SWEEP) {
      const n = mailUnread - prev.mailUnread;
      raised++;
      pushToast({
        kind: "info",
        title: `${n} new message${n === 1 ? "" : "s"}`,
        body: "Courier net updated",
        ttl: 5000,
      });
    }

    // --- rank movement ------------------------------------------------------
    if (
      raised < MAX_EVENTS_PER_SWEEP &&
      prev.overallRank !== null &&
      rank !== null &&
      rank !== prev.overallRank
    ) {
      const delta = prev.overallRank - rank; // positive == improved
      raised++;
      pushToast({
        kind: delta > 0 ? "success" : "info",
        title: `Power ranking ${delta > 0 ? "rose" : "fell"} to #${rank}`,
        ttl: 5200,
      });
    }

    // --- ascension ----------------------------------------------------------
    if (ascensionLevel > prev.ascensionLevel) {
      pushToast({
        kind: "success",
        title: `Ascended to level ${ascensionLevel}`,
        body: player.ascendedTitle
          ? `New title: ${player.ascendedTitle}`
          : "Hull systems upgraded",
        ttl: 9000,
      });
    }

    // --- destruction is terminal, so pin it ---------------------------------
    if (dead && !prev.dead) {
      pushToast({
        kind: "danger",
        title: "Your realm has been destroyed",
        body: player.destroyedByName
          ? `Annihilated by ${player.destroyedByName}`
          : "The realm is a dead shell",
        ttl: 0,
      });
    }

    base.current = {
      attackAt: Math.max(prev.attackAt, attackAt),
      intelAt: Math.max(prev.intelAt, intelAt),
      mailUnread,
      overallRank: rank,
      dead,
      ascensionLevel,
    };
  }, [ready, player, save, mailUnread]);

  return null;
}
