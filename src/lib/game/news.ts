import type { GameSave, NewsKind, UniverseNewsEntry } from "@/lib/db/schema";
import { uid } from "@/lib/game/economy";

export const MAX_NEWS = 60;

export function ensureNews(save: GameSave): UniverseNewsEntry[] {
  if (!save.news) save.news = [];
  return save.news;
}

export function pushNews(
  save: GameSave,
  kind: NewsKind,
  text: string,
): UniverseNewsEntry {
  const entry: UniverseNewsEntry = {
    id: uid("news"),
    at: Date.now(),
    kind,
    text: text.slice(0, 220),
  };
  const list = ensureNews(save);
  list.unshift(entry);
  if (list.length > MAX_NEWS) save.news = list.slice(0, MAX_NEWS);
  return entry;
}

const UNIVERSE_BLIPS = [
  "Gate network fluctuation detected in the outer rim.",
  "Naquadah futures spike across Cartel exchanges.",
  "Unaligned freighters report missing escorts near Abydos lane.",
  "Ancient beacon ping — origin unknown.",
  "Solar flare delays hyperspace relays for 0.3 cycles.",
  "Rumour: a Worldship silhouette crossed the Pegasus corridor.",
  "Covert chatter spikes on Lattice frequencies.",
  "Mining drones report anomalous crystal veins.",
];

export function maybeUniverseBlip(save: GameSave, chance = 0.12): void {
  if (Math.random() > chance) return;
  const text = UNIVERSE_BLIPS[Math.floor(Math.random() * UNIVERSE_BLIPS.length)]!;
  pushNews(save, "universe", text);
}

export function formatNewsTime(at: number): string {
  const d = new Date(at);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
