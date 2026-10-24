"use client";

/**
 * Toast notifications — a module store in the same shape as `gameClock`, so any
 * non-React code (or an effect watching game state) can raise one without
 * threading a callback through the tree.
 */
import { useSyncExternalStore } from "react";

export type ToastKind = "info" | "success" | "warn" | "danger";

export type Toast = {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
  /** Epoch ms when it appeared; the viewport derives remaining time from this. */
  at: number;
  /** Auto-dismiss deadline in ms. `0` pins the toast until dismissed. */
  ttl: number;
};

export type PushToast = {
  kind?: ToastKind;
  title: string;
  body?: string;
  ttl?: number;
};

const DEFAULT_TTL = 5200;
const MAX_VISIBLE = 4;

let nextId = 1;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getToasts(): Toast[] {
  return toasts;
}

export function subscribeToasts(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Raise a toast. Repeated identical titles collapse into the newest one. */
export function pushToast({
  kind = "info",
  title,
  body,
  ttl = DEFAULT_TTL,
}: PushToast): number {
  const existing = toasts.find((t) => t.title === title && t.kind === kind);
  if (existing) {
    // Refresh in place so a spammy source can't fill the stack.
    existing.at = Date.now();
    existing.body = body ?? existing.body;
    emit();
    return existing.id;
  }

  const toast: Toast = { id: nextId++, kind, title, body, at: Date.now(), ttl };
  toasts = [toast, ...toasts].slice(0, MAX_VISIBLE);
  emit();
  return toast.id;
}

export function dismissToast(id: number): void {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

export function clearToasts(): void {
  if (!toasts.length) return;
  toasts = [];
  emit();
}

/** Subscribe to the live toast list. */
export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribeToasts, getToasts, getToasts);
}
