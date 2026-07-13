"use client";

/**
 * Lightweight clock store — countdown ticks without re-rendering GameProvider
 * or every page subscribed to the full game context.
 */
import { useSyncExternalStore } from "react";

type ClockState = {
  msToTurn: number;
  msToAiPulse: number;
};

type Listener = () => void;

let state: ClockState = { msToTurn: 0, msToAiPulse: 0 };
const listeners = new Set<Listener>();

export function getGameClock(): ClockState {
  return state;
}

export function subscribeGameClock(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setGameClock(next: Partial<ClockState>): void {
  const msToTurn = next.msToTurn ?? state.msToTurn;
  const msToAiPulse = next.msToAiPulse ?? state.msToAiPulse;
  // Only notify when the displayed second would change
  const turnSec = Math.ceil(msToTurn / 1000);
  const aiSec = Math.ceil(msToAiPulse / 1000);
  const prevTurnSec = Math.ceil(state.msToTurn / 1000);
  const prevAiSec = Math.ceil(state.msToAiPulse / 1000);
  state = { msToTurn, msToAiPulse };
  if (turnSec === prevTurnSec && aiSec === prevAiSec) return;
  for (const l of listeners) l();
}

/** Subscribe to turn/AI countdowns without re-rendering the whole game tree. */
export function useGameClock(): ClockState {
  return useSyncExternalStore(subscribeGameClock, getGameClock, getGameClock);
}
