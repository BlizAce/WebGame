# GateWars — Design & Architecture Document

> Working title for this project: **webWars / GateWars**  
> Historical name: **StarGateWars (SGW)** / **TheGateWars (TGW)**  
> Target stack: **Next.js** · **Pixel.js** · **browser `localStorage`** · **bash setup for Bazzite & Ubuntu**

This document captures the original game’s systems and maps them onto a local, install-light web remake. It is the source of truth for implementation planning.

---

## 1. What GateWars Is

GateWars is a long-running **persistent browser-based game (PBBG)**: turn-based sci-fi strategy with resource management, PvP combat, trade, and espionage.

| Fact | Detail |
|------|--------|
| Origin | Launched ~Feb 2005 as StarGateWars |
| Rebrand | Later GateWars / gatewa.rs (Kingdom Games Ltd.) |
| Genre | Turn-based strategy / browser MMORPG |
| Classic interface | Mostly text/HTML forms |
| Turn cadence | Every **30 minutes** (48 turns/day) |
| Theme | Gate-network sci-fi realms fighting for cosmic control |

**This remake’s intent:** keep the classic economy/combat loop, present it with a **Pixel.js** canvas layer (sprites, battle scenes, race-themed command centers), and persist everything in the browser via **`localStorage`** — no SQL server, no Docker DB, nothing to install beyond Node tooling.

> **IP note:** The live game states it is not affiliated with any TV/film company. This project should use **original or GateWars-style naming** for races/units where needed, and avoid shipping copyrighted Stargate media assets.

---

## 2. Core Game Loop (What We Are Rebuilding)

```
Every 30 min turn tick
  → gain Naquadah (Naq) + Untrained Units (UU)
  → player spends Naq on training / weapons / tech / bank / UP
  → player spends Attack Turns (1–15) to Attack / Raid
  → player spends Covert capacity to Spy / Sabotage / Assassinate
  → ranks update from Strike / Defence / Covert / Anti-Covert (and later Mothership)
```

### 2.1 Primary resources

| Resource | Role |
|----------|------|
| **Naquadah (Naq)** | Currency — train, buy weapons, upgrade tech/UP/bank |
| **Untrained Units (UU)** | Population pool — train into military/covert roles; small income |
| **Attack Turns (AT)** | Spent on attack/raid (1–15 per action) |
| **Covert capacity / Covert Turns** | Spent on spy/sabotage/assassinate |
| **Unit Production (UP)** | Permanent growth rate for UU per turn — never stolen |
| **Bank / Vault Naq** | Protected stash (deposit fee unless race bonus); not lootable on attack |

### 2.2 Income (Origins-style baseline)

- **4 Naq** per civilian / untrained unit per turn  
- **8 Naq** per offensive military unit per turn  
- **8 Naq** per defensive military unit per turn  
- Reduced by **Attack Fatigue** (offence income) and **Defence Alert / Defcon** (defence income)  
- Race bonuses applied to totals (e.g. Goa’uld income)

### 2.3 Combat & covert actions

| Action | Cost | Win condition / effect |
|--------|------|-------------------------|
| **Attack** | 1–15 AT | If Strike > Defence → steal ~60–100% of 75% of open Naq; casualties if disparity ≥20%; weapons take wear |
| **Raid** | AT | Steal UU instead of Naq; typically no anti-covert spy engagement |
| **Spy** | Covert | Reveal enemy stats (chance per field); fail → losses / detection |
| **Sabotage** | Covert | Destroy weak weapons first; max ~2% of enemy weapons; always some agent loss |
| **Assassinate** | Covert | Kill enemy spies / anti-spies; defender always learns who did it |
| **Conquer planet** (later) | Fleet / day limit | Annex planet support; risk fleet |

Displayed Strike/Defence is a **potential**; actual rolls often land around **75–100%** of potential.

### 2.4 Races (v1)

| Race | Classic bonus (Origins) | Unit flavour examples |
|------|-------------------------|------------------------|
| **Asgard** | +20% Defence | Attack/Defence Drones, Planetary Vault |
| **Goa’uld** | +20% Income + free banking | Jaffa Raiders/Guards, Secret Temple |
| **Replicator** | +10% Attack & +10% Defence | Attack/Defence Spiders, Time Chamber |
| **Tau’ri** | +20% Attack | Away Teams / Home Base Guard, Alpha Site |

Race change is costly (lose tech, trained units, bank, weapons; keep UU, covert levels, UP).

### 2.5 Screens / modules to implement

1. **Command Center** — stats, ranks, personnel, alliance, alert/fatigue  
2. **Attack / Rankings** — target list, engage, spy/sabotage/message  
3. **Attack Log** — inbound/outbound battles  
4. **Armory** — buy/sell/repair/scrap attack & defence weapons  
5. **Training** — UU → offence/defence/covert/anticovert; UP / spy / anti-spy levels  
6. **Technology** — weapon power / combat multipliers  
7. **Intelligence** — covert mission log  
8. **Bank / Vault** — deposit/withdraw protected Naq  
9. **Alliances** (phase 2) — create/join, ranks, news  
10. **Market / Ascension / Mothership / Planets** (later phases)

### 2.6 Permanent vs stealable progress

**Never stolen:** UP level, spy level, anti-spy level (and similar permanent upgrades).  
**At risk:** open Naq, weapons (sabotage), units (casualties / raid), temporary alert/fatigue.

---

## 3. Product Shape for This Remake

Because we use **localStorage only**, v1 is a **single-player / local sandbox** with:

- One human player realm  
- **AI / simulated rival realms** stored in the same local DB (so Attack, Spy, Rankings still feel like GateWars)  
- Optional export/import of save JSON (backup / share)  
- Turn clock driven in the client (30-minute ticks, or a “dev accelerate” toggle)

True multiplayer would need a server later; this document deliberately stays offline-first.

---

## 4. Technology Stack

| Layer | Choice | Why |
|-------|--------|-----|
| App framework | **Next.js** (App Router) | Pages/routes for CC, Attack, Armory, etc.; React UI for forms/tables |
| Visual engine | **Pixel.js** | Canvas layers, sprites, sprite sheets, simple entities for race scenes & battle FX |
| Persistence | **`localStorage`** (+ thin repository API) | Zero install DB; works on Bazzite/Ubuntu browsers |
| Language | TypeScript | Shared types for realm, combat, storage schema |
| Package manager | npm (via Node from setup script) | Predictable on both distros |
| Bootstrap | **`scripts/setup.sh`** | Detect OS, install Node if needed, `npm install`, verify |

### 4.1 How Pixel.js fits a turn-based PBBG

Classic GateWars was text-heavy. Pixel.js is not the rules engine — it is the **presentation layer**:

| Pixel.js use | GateWars mapping |
|--------------|------------------|
| Layered canvas in Command Center | Race-themed base / gate room backdrop + idle unit sprites |
| AnimatedSprite sheets | Offence/defence/covert unit idle & march cycles |
| Player / Entity (optional) | Small “walk the base” flavour scene — not core strategy |
| Battle overlay scene | Short attack/raid animation before result panel |
| Asset folders | `public/assets/{tiles,sprites,sprite_sheets,sounds}/` |

**Game rules, turns, combat math, and storage live in TypeScript modules** (`lib/game/*`). Pixel.js only reads state and renders.

### 4.2 Next.js + Pixel.js integration pattern

```
app/                          # Next.js routes (React UI)
  page.tsx                    # Landing / race select
  play/command-center/        # Stats + Pixel canvas host
  play/attack/
  play/armory/
  play/training/
  ...
components/
  PixelStage.tsx              # Client-only canvas mount (dynamic import, ssr: false)
  GameShell.tsx               # Left nav + resource HUD (classic SGW layout)
lib/
  game/
    turns.ts                  # Turn tick, income, UU, AT regen
    combat.ts                 # Strike vs Defence, loot, casualties
    covert.ts                 # Spy / sabotage / assassinate
    economy.ts                # Bank, UP costs, weapon prices
    races.ts                  # Bonuses + unit name tables
    rankings.ts
  db/
    schema.ts                 # Types + versioned save shape
    localStore.ts             # get/set/migrate localStorage
    repositories.ts           # realm, rivals, logs, settings
  pixel/
    engine.ts                 # PixelJS.Engine bootstrap
    scenes/commandCenter.ts
    scenes/battle.ts
public/assets/                # Pixel.js media
scripts/setup.sh
```

`PixelStage` must be a **client component**. Pixel.js expects a DOM container id and an assets path under `public/`.

---

## 5. Local Database Design (`localStorage`)

No SQL. One versioned JSON document (or a small set of keys) behind a repository API.

### 5.1 Keys

| Key | Contents |
|-----|----------|
| `gatewars:meta` | `{ schemaVersion, createdAt, updatedAt }` |
| `gatewars:settings` | Turn length, sound, accelerate mode, theme |
| `gatewars:player` | Human realm state |
| `gatewars:rivals` | Array of AI realms |
| `gatewars:logs` | Attack + intelligence logs (capped) |
| `gatewars:alliances` | Optional phase-2 data |

Prefer a single `gatewars:save` blob if simpler for v1 export/import — repositories can still split logically in code.

### 5.2 Realm schema (conceptual)

```ts
type RaceId = 'asgard' | 'goauld' | 'replicator' | 'tauri';

interface Realm {
  id: string;
  name: string;
  race: RaceId;
  isPlayer: boolean;

  // Resources
  naquadah: number;          // open / lootable
  bankNaquadah: number;
  bankLevel: number;
  attackTurns: number;
  restedAttackTurns: number;
  covertCapacity: number;

  // Permanent growth
  unitProductionLevel: number;
  spyLevel: number;
  antiSpyLevel: number;
  techLevel: number;

  // Personnel
  units: {
    untrained: number;
    offence: number;
    defence: number;
    covert: number;
    antiCovert: number;
  };

  // Armory
  weapons: WeaponStack[];    // type, qty, durability%

  // Status
  defenceAlert: number;      // 0–50
  attackFatigue: number;     // 0–50
  vacation: boolean;
  allianceId?: string;

  // Derived caches (recomputed, not source of truth)
  strikeAction?: number;
  defenceAction?: number;
  covertAction?: number;
  antiCovertAction?: number;
}

interface WeaponStack {
  id: string;
  slot: 'attack' | 'defence';
  power: number;
  maxDurability: number;
  durability: number;        // shared wear model per type
  quantity: number;
  buyCost: number;
}

interface GameSave {
  schemaVersion: number;
  lastTickAt: number;        // epoch ms — catch up missed turns on load
  playerId: string;
  realms: Realm[];
  logs: {
    attacks: AttackLogEntry[];
    intelligence: IntelLogEntry[];
  };
  settings: {
    turnMinutes: number;     // default 30; allow 1 for testing
    pixelEnabled: boolean;
  };
}
```

### 5.3 Migration

`localStore.load()`:

1. Read JSON  
2. If missing → create starter save (player + N AI rivals)  
3. If `schemaVersion` < current → run migrate functions  
4. Apply **missed turn ticks** from `lastTickAt` → now (cap catch-up, e.g. max 48 turns)

### 5.4 Limits (browser reality)

- Keep logs trimmed (e.g. last 200 attack + 200 intel entries)  
- Avoid huge rival counts in v1 (8–20 AI realms is enough)  
- Offer **Export save** / **Import save** / **Reset** in settings  
- `localStorage` is per-origin and can be cleared by the user — document that clearly in-app

---

## 6. UI / UX Mapping (Classic → Remake)

Keep the **classic left-column game shell**:

```
┌────────────┬──────────────────────────────────────────┐
│ GateWars   │  [Pixel.js stage: race command scene]    │
│ Naq / Bank │──────────────────────────────────────────│
│ Turns / UP │  React panels: tables, forms, results    │
│ Rank       │                                          │
│────────────│                                          │
│ Command    │                                          │
│ Attack     │                                          │
│ Attack Log │                                          │
│ Armory     │                                          │
│ Training   │                                          │
│ Technology │                                          │
│ Intel      │                                          │
│ Bank       │                                          │
└────────────┴──────────────────────────────────────────┘
```

Pixel stage = atmosphere + feedback. React = the actual game (as in the original HTML UI).

---

## 7. Combat & Economy Modules (Implementation Order)

### Phase 0 — Foundation
- Next.js app scaffold  
- `setup.sh` (Bazzite + Ubuntu)  
- `localStore` + starter save  
- Game shell + empty routes  
- Pixel.js hello scene on Command Center  

### Phase 1 — Economy MVP
- Turn ticker + income + UU from UP  
- Training (UU → 4 unit types)  
- UP / spy / anti-spy upgrade costs  
- Bank deposit/withdraw (+ race free banking)  
- Armory buy/repair/sell  

### Phase 2 — PvP loop vs AI
- Generate rival realms  
- Rankings list  
- Attack (1–15 turns), loot Naq, casualties, weapon wear  
- Attack log + Pixel battle sting  
- Spy / sabotage / intelligence log  

### Phase 3 — Depth
- Alert / fatigue  
- Alliances (local)  
- Technology tree  
- Race change / vacation / rename  
- Save export/import  

### Phase 4 — Stretch
- Raid, assassinate, planets, mothership  
- ~~Market simulation~~ (Open Market: UU / attack turns ↔ Naq, flood pricing, AI traders)  
- Ascension-style prestige reset  

---

## 8. Setup Script Requirements (`scripts/setup.sh`)

Goal: **one command** on a fresh Bazzite or Ubuntu machine installs tooling and project deps.

### 8.1 Behaviours

1. Detect OS (`/etc/os-release`: `ID=bazzite` / `ID=fedora` variants vs `ID=ubuntu`)  
2. Ensure **Node.js LTS ≥ 20** and **npm**  
   - Ubuntu: NodeSource or `nodejs`/`npm` via apt, or **nvm**  
   - Bazzite (immutable Fedora Atomic): prefer **nvm** or **Homebrew/Linux** / flatpak-friendly user install — **do not** assume `dnf install` into the immutable root without checking  
3. Verify `node -v`, `npm -v`  
4. From repo root: `npm install`  
5. Optionally `npm run build` smoke check  
6. Print next steps: `npm run dev` → open `http://localhost:3000`  
7. Idempotent: safe to re-run  

### 8.2 Suggested usage

```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
npm run dev
```

### 8.3 Distro notes

| Distro | Approach |
|--------|----------|
| **Ubuntu** | `apt` packages or nvm; classic mutable root |
| **Bazzite** | Atomic desktop — install Node in **user space** (nvm recommended); script should detect immutability and avoid broken system package paths |

Script should set `NODE_MAJOR=20` (or 22 LTS) and refuse to continue if Node is too old.

---

## 9. Suggested npm Scripts

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "setup": "bash scripts/setup.sh"
  }
}
```

---

## 10. Pixel.js Asset Conventions

Mirror Pixel.js expectations under `public/`:

```
public/assets/
  tiles/
  sprites/
  sprite_sheets/
  sounds/
```

In engine bootstrap:

```js
PixelJS.assetPath = '/assets';
```

Race packs (example):

- `sprite_sheets/asgard_units.png`  
- `sprite_sheets/goauld_units.png`  
- `tiles/command_asgard.png`  
- Battle FX shared under `sprites/fx_*`

Keep art **original** (pixel sci-fi), not ripped from Stargate media.

---

## 11. Reference Sources (for designers)

- Live portal: https://gatewa.rs/  
- Origins help (mechanics close to classic): https://origins.gatewa.rs/help.php  
- Historical wiki overview: https://stargatewars.fandom.com/wiki/StargateWars  
- Pixel.js: https://rastating.github.io/pixel.js/  
- Pixel.js Getting Started: https://rastating.github.io/pixel.js/getting-started/  

Formulas in Origins help (income, sabotage, assassinate) should be ported into `lib/game/*.ts` with unit tests where practical.

---

## 12. Non-Goals (v1)

- Dedicated SQL / Postgres / SQLite server  
- Real-time multiplayer networking  
- PayPal / supporter status / real-money PPT  
- Shipping copyrighted franchise assets  
- Exact 1:1 clone of every Main/Ascended/Quantum server feature  

---

## 13. Success Criteria

A developer on **Bazzite or Ubuntu** can:

1. Clone the repo  
2. Run `./scripts/setup.sh`  
3. Run `npm run dev`  
4. Create a race, watch turns accrue Naq/UU in localStorage  
5. Train units, buy a weapon, attack an AI rival  
6. See a Pixel.js scene on the Command Center and a short battle animation  

When those work, the GateWars loop is alive on the intended stack.

---

## 14. Glossary (player lingo)

| Term | Meaning |
|------|---------|
| Naq | Naquadah — money |
| UU | Untrained units |
| UP | Unit production |
| AT | Attack turns |
| CC | Command Center |
| SA / DA | Strike Action / Defensive Action |
| SL / ACL | Spy level / Anti-covert level |
| PPT | Protected Planet Treaty (skip in v1) |
| SS | Supporter status (skip in v1) |
| Massing | Repeated hits to wipe defence |
| Farming | Repeatedly hitting the same target |
| Phasing | Realm temporarily locked after extreme attack volume |

---

*Document version: 0.1 — initial architecture for webWars / GateWars remake.*
