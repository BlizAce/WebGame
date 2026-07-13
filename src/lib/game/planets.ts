import type { Planet } from "@/lib/db/schema";
import { uid } from "@/lib/game/economy";

const PLANET_NAMES = [
  "Abydos Reach",
  "Chulak Drift",
  "Langara Prime",
  "Tollana Gate",
  "Orban Shelf",
  "P3X-888",
  "Euronda Rim",
  "Latona Spire",
  "Vyus Hollow",
  "Cimmeria Nest",
  "Nasya Basin",
  "Madrona Well",
  "Hebridan Dock",
  "Tegalus Arc",
  "Galar Crown",
  "Athos Beacon",
];

export function createGalaxyPlanets(): Planet[] {
  return PLANET_NAMES.map((name, i) => {
    const tier = 1 + (i % 4);
    return {
      id: uid("planet"),
      name,
      ownerId: null,
      miningYield: 40 + tier * 35 + (i % 3) * 15,
      upYield: tier + (i % 2),
      defenceRating: 200 + tier * 180 + i * 40,
    };
  });
}
