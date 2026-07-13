import type { RaceId, WeaponStack } from "@/lib/db/schema";

export interface RaceDef {
  id: RaceId;
  name: string;
  tagline: string;
  attackBonus: number;
  defenceBonus: number;
  incomeBonus: number;
  freeBanking: boolean;
  bankName: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    glow: string;
  };
  units: {
    untrained: string;
    miners: string;
    offence: string;
    defence: string;
    covert: string;
    antiCovert: string;
  };
}

export const RACES: Record<RaceId, RaceDef> = {
  asgard: {
    id: "asgard",
    name: "Asgard",
    tagline: "Fortress science — defence first",
    attackBonus: 0,
    defenceBonus: 0.2,
    incomeBonus: 0,
    freeBanking: false,
    bankName: "Planetary Vault",
    colors: {
      primary: "#7ec8e3",
      secondary: "#1a3a4a",
      accent: "#c8f0ff",
      glow: "#4fd2ff",
    },
    units: {
      untrained: "General Drones",
      miners: "Mining Drones",
      offence: "Attack Drones",
      defence: "Defense Drones",
      covert: "Undercover Agents",
      antiCovert: "Anti-Intelligence Drones",
    },
  },
  goauld: {
    id: "goauld",
    name: "Goa'uld",
    tagline: "Golden empire — income & free banking",
    attackBonus: 0,
    defenceBonus: 0,
    incomeBonus: 0.2,
    freeBanking: true,
    bankName: "Secret Temple",
    colors: {
      primary: "#d4a017",
      secondary: "#2a1a08",
      accent: "#ffe08a",
      glow: "#ffb020",
    },
    units: {
      untrained: "Untrained Jaffa",
      miners: "Temple Miners",
      offence: "Jaffa Raiders",
      defence: "Jaffa Guards",
      covert: "Undercover Agents",
      antiCovert: "Assassins",
    },
  },
  replicator: {
    id: "replicator",
    name: "Replicator",
    tagline: "Swarm logic — balanced steel",
    attackBonus: 0.1,
    defenceBonus: 0.1,
    incomeBonus: 0,
    freeBanking: false,
    bankName: "Time Chamber",
    colors: {
      primary: "#c0c8d0",
      secondary: "#1c2228",
      accent: "#e8f0f8",
      glow: "#9ad0ff",
    },
    units: {
      untrained: "Unassigned Spiders",
      miners: "Harvester Spiders",
      offence: "Attack Spiders",
      defence: "Defense Spiders",
      covert: "Infiltration Units",
      antiCovert: "Covert Infiltrator Bots",
    },
  },
  tauri: {
    id: "tauri",
    name: "Tau'ri",
    tagline: "Strike hard — attack specialists",
    attackBonus: 0.2,
    defenceBonus: 0,
    incomeBonus: 0,
    freeBanking: false,
    bankName: "Alpha Site",
    colors: {
      primary: "#3d8bfd",
      secondary: "#0c1a2e",
      accent: "#9ec5ff",
      glow: "#5aa8ff",
    },
    units: {
      untrained: "Untrained Personnel",
      miners: "Mining Teams",
      offence: "Offensive Away Teams",
      defence: "Home Base Guards",
      covert: "Undercover Agents",
      antiCovert: "CounterIntelligence Agents",
    },
  },
};

export const RACE_LIST = Object.values(RACES);

function w(
  id: string,
  slot: "attack" | "defence",
  name: string,
  power: number,
  maxDurability: number,
  buyCost: number,
  techReq: number,
): WeaponStack {
  return {
    id,
    slot,
    name,
    power,
    maxDurability,
    durability: maxDurability,
    quantity: 0,
    buyCost,
    techReq,
  };
}

export function starterWeapons(race: RaceId): WeaponStack[] {
  const atk =
    race === "tauri" ? 0.85 : race === "replicator" ? 0.92 : 1;
  const def =
    race === "asgard" ? 0.85 : race === "replicator" ? 0.92 : 1;

  return [
    w(`${race}-atk-1`, "attack", "Light Pulse Rifle", 10, 100, Math.floor(90 * atk), 1),
    w(`${race}-atk-2`, "attack", "Heavy Gate Cannon", 40, 200, Math.floor(450 * atk), 1),
    w(`${race}-atk-3`, "attack", "Plasma Lance", 90, 280, Math.floor(1400 * atk), 3),
    w(`${race}-atk-4`, "attack", "Singularity Array", 180, 400, Math.floor(4200 * atk), 5),
    w(`${race}-def-1`, "defence", "Shield Lattice", 10, 100, Math.floor(90 * def), 1),
    w(`${race}-def-2`, "defence", "Orbital Battery", 40, 200, Math.floor(450 * def), 1),
    w(`${race}-def-3`, "defence", "Aegis Dome", 90, 280, Math.floor(1400 * def), 3),
    w(`${race}-def-4`, "defence", "World Barrier", 180, 400, Math.floor(4200 * def), 5),
  ];
}
