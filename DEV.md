# GateWars — Developer Handbook

This document is the practical guide for **editing and extending** the codebase.  
For classic GateWars design intent and mechanics mapping, see [`docs/GATEWARS.md`](docs/GATEWARS.md).  
For player-facing quick start, see [`README.md`](README.md).

---

## Table of contents

1. [Overview](#1-overview)
2. [Tech stack](#2-tech-stack)
3. [Dependencies](#3-dependencies)
4. [Scripts](#4-scripts)
5. [Environment & runtime](#5-environment--runtime)
6. [Persistence model](#6-persistence-model)
7. [Codebase map](#7-codebase-map)
8. [Architecture & data flow](#8-architecture--data-flow)
9. [Game systems index](#9-game-systems-index)
10. [How to extend](#10-how-to-extend)
11. [Conventions & pitfalls](#11-conventions--pitfalls)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Overview

**GateWars / webWars** is a single-process Next.js app that simulates a GateWars-style PBBG locally:

- One human player realm + a large living AI population (seeded toward ~1000 AIs).
- All game rules run in TypeScript (`src/lib/game/*`).
- UI is App Router pages under `src/app/play/*`.
- Save blob is a JSON `GameSave` stored in SQLite (`data/gatewars.sqlite`).

There is **no separate game server process**. The Next.js server hosts API routes; the browser holds live state via `GameContext` and soft-commits to `/api/save`.

---

## 2. Tech stack

| Layer | Choice | Notes |
|-------|--------|--------|
| Framework | **Next.js 16** (App Router) | See `AGENTS.md` — APIs may differ from older Next training data |
| UI | **React 19** | Client components for play screens |
| Language | **TypeScript 5** (strict) | Path alias `@/*` → `src/*` |
| Styling | **Tailwind CSS 4** + custom CSS vars in `globals.css` | Race-themed tokens (`--race-*`) |
| Persistence | **better-sqlite3** | Native addon; marked `serverExternalPackages` in `next.config.ts` |
| Graphics | Canvas 2D + procedural wireframes | `VectorStage`, `src/lib/gfx/*` |
| Optional AI | OpenAI-compatible HTTP LLM | Forum / mind / mail via `src/lib/server/llmQueue.ts` |
| Lint | ESLint 9 + `eslint-config-next` | `npm run lint` |

**Node:** 20+ required (`scripts/setup.sh` / `scripts/setup.bat` enforce this).

---

## 3. Dependencies

### Runtime (`dependencies`)

| Package | Role |
|---------|------|
| `next` | App framework, routing, API routes, build |
| `react` / `react-dom` | UI |
| `better-sqlite3` | Server-side SQLite for the save file |

### Development (`devDependencies`)

| Package | Role |
|---------|------|
| `typescript` | Typechecking (`tsc` via editor / `next build`) |
| `@types/node`, `@types/react`, `@types/react-dom`, `@types/better-sqlite3` | Typings |
| `eslint`, `eslint-config-next` | Linting |
| `tailwindcss`, `@tailwindcss/postcss` | Utility CSS pipeline |
| `postcss` (via Tailwind PostCSS plugin) | CSS transform |

### System / native

- **Node.js ≥ 20** and npm
- **Build tools for native modules** (needed by `better-sqlite3`):
  - Ubuntu/Debian: `build-essential`, `python3`
  - Fedora/Bazzite: usually fine via nvm + npm; if install fails, install C++ toolchain for your distro
- Optional: local LLM runtime (Ollama, LM Studio, etc.) for AI minds

---

## 4. Scripts

Defined in `package.json` and `scripts/`.

### `npm run setup` → `bash scripts/setup.sh`

Full bootstrap for Ubuntu and Bazzite-style immutable systems:

1. Detects OS (`/etc/os-release`).
2. Ensures **Node 20+** (apt/NodeSource on Ubuntu; **nvm** on Bazzite/Atomic/unknown).
3. Runs `npm install`.
4. Runs `npm run build` as a smoke test (skip with `SKIP_BUILD=1`).

```bash
./scripts/setup.sh
SKIP_BUILD=1 ./scripts/setup.sh   # install only
npm run setup                     # same as ./scripts/setup.sh
```

### `npm run setup:win` → `scripts\setup.bat`

Windows bootstrap:

1. Ensures **Node 20+** (installs LTS via **winget** when missing).
2. Runs `npm install`.
3. Runs `npm run build` as a smoke test (skip with `set SKIP_BUILD=1` before running).

```bat
scripts\setup.bat
set SKIP_BUILD=1 && scripts\setup.bat
npm run setup:win
```

If `better-sqlite3` fails to compile, install Visual Studio Build Tools (C++ workload).

### `npm run launch` / `npm run launch:win`

Convenience launchers that check Node 20+, run `npm install` if `node_modules` is missing, then start the dev server.

```bash
./scripts/launch.sh              # Linux / macOS
PORT=3001 ./scripts/launch.sh    # custom port
npm run launch
```

```bat
scripts\launch.bat
set PORT=3001 && scripts\launch.bat
npm run launch:win
```

### `npm run dev`

Starts the Next.js **development** server (hot reload).  
Default URL: [http://localhost:3000](http://localhost:3000).

Creates `data/` and `data/gatewars.sqlite` on first save.

### `npm run build`

Production compile + typecheck. Fails if TypeScript or Next build errors exist.  
Use before PRs / after large refactors.

### `npm run start`

Serves the **already-built** `.next` output (`next start`).  
Run `npm run build` first.

### `npm run lint`

Runs ESLint with Next core-web-vitals + TypeScript configs (`eslint.config.mjs`).

### Manual checks (not npm scripts, but useful)

```bash
npx tsc --noEmit          # typecheck without emitting
rm -rf data               # wipe local save (destructive)
```

---

## 5. Environment & runtime

| Variable | Default | Purpose |
|----------|---------|---------|
| `GATEWARS_LLM_BASE_URL` | Settings / `DEFAULT_SETTINGS.llmBaseUrl` | OpenAI-compatible API base (e.g. `http://127.0.0.1:11434/v1`) |
| `GATEWARS_LLM_MODEL` | Settings default | Model id |
| `GATEWARS_LLM_API_KEY` | empty | Bearer token if the endpoint needs one |
| `SKIP_BUILD` | `0` | When `1`, `setup.sh` / `setup.bat` skip the smoke build |
| `PORT` | `3000` | Dev server port used by `launch.sh` / `launch.bat` |

Copy pattern for a local `.env.local` (gitignored):

```bash
GATEWARS_LLM_BASE_URL=http://127.0.0.1:11434/v1
GATEWARS_LLM_MODEL=llama3.2
GATEWARS_LLM_API_KEY=
```

In-game **Settings** can also store LLM URL/model on the save; server env overrides are applied in `llmQueue.ts`.

---

## 6. Persistence model

```
Browser GameContext (live GameSave)
        │ softCommit / flush
        ▼
   POST /api/save
        ▼
 src/lib/server/sqliteSave.ts
        ▼
 data/gatewars.sqlite  (table: saves, id = "default")
```

| Piece | Path | Notes |
|-------|------|--------|
| Schema types | `src/lib/db/schema.ts` | `SCHEMA_VERSION` — bump when save shape changes |
| Migrate / hydrate | `src/lib/db/localStore.ts` | `migrate()`, realm defaults, browser→server one-shot |
| Seed / AI population | `src/lib/db/seed.ts` | `TARGET_AI_COUNT`, starting realms |
| Compact dead weight | `src/lib/db/compactSave.ts` | Shrinks save before write |
| SQLite I/O | `src/lib/server/sqliteSave.ts` | WAL mode; `getSave` / `putSave` |

**When you change save fields:**

1. Update interfaces in `schema.ts`.
2. Bump `SCHEMA_VERSION`.
3. Add defaults in `migrate()` / `migrateRealm()` in `localStore.ts`.
4. Update seed / compact paths if needed.
5. Keep UI and AI paths resilient to missing fields (`??` defaults).

The `data/` directory is **gitignored** — never commit live saves.

---

## 7. Codebase map

```
webWars/
├── README.md                 # Player / quick start
├── DEV.md                    # This handbook
├── AGENTS.md                 # Next.js agent caveats
├── package.json              # Scripts & dependencies
├── next.config.ts            # serverExternalPackages: better-sqlite3
├── tsconfig.json             # @/* path alias
├── eslint.config.mjs
├── postcss.config.mjs
├── scripts/
│   ├── setup.sh              # Linux: OS-aware Node + npm install + build
│   ├── setup.bat             # Windows: winget Node + npm install + build
│   ├── launch.sh             # Linux/macOS: start npm run dev
│   └── launch.bat            # Windows: start npm run dev
├── docs/
│   └── GATEWARS.md           # Design / classic mechanics
├── data/                     # LOCAL ONLY — SQLite save (gitignored)
├── public/                   # Static assets (tiles, sprites, sounds)
└── src/
    ├── app/                  # Next.js App Router
    │   ├── layout.tsx        # Root layout + Providers
    │   ├── page.tsx          # Landing / create realm
    │   ├── globals.css       # Theme, gw-* UI primitives
    │   ├── api/
    │   │   ├── save/route.ts           # GET/PUT GameSave
    │   │   └── forum/llm/…             # LLM proxy endpoints
    │   └── play/             # Authenticated play area pages
    │       ├── command-center/
    │       ├── training/ armory/ technology/ bank/
    │       ├── attack/ war-room/ intelligence/ attack-log/
    │       ├── mothership/ planets/ rankings/ ascension/
    │       ├── guilds/ market/ contracts/ forum/ mail/
    │       └── settings/
    ├── components/           # Shared React UI
    │   ├── Providers.tsx     # Game + profile providers
    │   ├── PlayGate.tsx      # Requires loaded save + stage mode
    │   ├── GameShell.tsx     # Nav chrome for /play/*
    │   ├── VectorStage.tsx   # Background canvas stage
    │   ├── BattleScene.tsx
    │   ├── RealmLink.tsx / GuildLink.tsx + profile modals
    │   └── …
    └── lib/
        ├── db/               # Schema, migrate, seed, compact
        ├── game/             # ALL game rules + GameContext
        ├── gfx/              # Wireframes, stage themes, color
        └── server/           # SQLite + LLM queue (Node-only)
```

### 7.1 Pages (`src/app/play/*`)

| Route | Purpose |
|-------|---------|
| `/play/command-center` | Hub stats, quick overview |
| `/play/training` | Train units from UU |
| `/play/armory` | Buy/repair/sell weapons; link to mothership |
| `/play/mothership` | Hull tiers, capacity, fitted banks, modules |
| `/play/technology` | Tech branches (+ Buy Max) |
| `/play/bank` | Vault deposit/withdraw |
| `/play/market` | Commodity market |
| `/play/attack` | Target list, attack/raid/covert/eradicate |
| `/play/war-room` | Guild war targeting |
| `/play/intelligence` | Spy reports |
| `/play/attack-log` | Battle history |
| `/play/guilds` | Alliances, wars, fleet clusters |
| `/play/planets` | Conquer / manage planets |
| `/play/rankings` | Cached multi-category ranks |
| `/play/ascension` | Soft-reset prestige |
| `/play/contracts` | Contracts system |
| `/play/forum` | Public / guild forum (+ LLM) |
| `/play/mail` | Realm mail (+ LLM) |
| `/play/settings` | Clock, AI, rankings, LLM, export/import, reset |

### 7.2 Game logic modules (`src/lib/game/*`)

| File | Responsibility |
|------|----------------|
| `GameContext.tsx` | React state, player actions, commit to `/api/save`, background loops |
| `actions.ts` | Shared mutations for player + AI plan executor |
| `schema` consumers via `economy.ts` | Formatting, strike/defence, train costs, re-exports |
| `turns.ts` | Turn catch-up, income, attack-turn regen |
| `combat.ts` | Attack, raid, eradicate, planet conquer resolution |
| `covert.ts` | Spy / sabotage / assassinate |
| `mothership.ts` | Hull, capacity, fittings, modules, power formulas |
| `ai.ts` | Heuristic AI pulse (train, fight, MS, guilds, …) |
| `mind.ts` + `mindLlmClient.ts` | LLM “soul” / plan generation |
| `simScheduler.ts` | Chunked AI brains, rankings refresh, soft scheduling |
| `rankings.ts` | Cache rebuild, overall rank, **attack rank range** |
| `guilds.ts` | Alliances, factions, guild tech/funds |
| `wars.ts` | Guild wars, eradication odds, destroy realm |
| `fleetClusters.ts` | Combined defence clusters |
| `market.ts` | Prices, trades, history |
| `planets.ts` | Galaxy planet generation / ownership helpers |
| `ascension.ts` | Requirements + soft reset |
| `races.ts` | Race bonuses + starter weapons |
| `forum.ts` / `mail.ts` / `news.ts` | Social systems |
| `contracts.ts` | Contracts |
| `intelVisibility.ts` | Fog of war for spy intel |
| `gameClock.ts` | Shared clock helpers |
| `aiWorldContext.ts` | Prompt snippets for LLM AIs |
| `ProfileContext.tsx` | Realm/guild profile modal state |

### 7.3 Server-only (`src/lib/server/*`)

| File | Responsibility |
|------|----------------|
| `sqliteSave.ts` | Open DB, get/put JSON save |
| `llmQueue.ts` | Concurrent LLM request queue + env defaults |

Do **not** import these from client components — they use Node APIs / native SQLite.

---

## 8. Architecture & data flow

### 8.1 Boot

1. `Providers` → `GameContext` loads save (`localStore` → `/api/save`).
2. `migrate(save)` normalizes schema / missing fields.
3. Optional one-time browser `localStorage` migrate → SQLite.
4. `catchUpTurns` / `catchUpAi` advance simulation if the clock jumped.
5. Rankings cache may rebuild async (`simScheduler`).

### 8.2 Player action

```
UI button → GameContext method → mutate GameSave clone → commit()
  → softCommit schedules POST /api/save
  → sqliteSave.putSave(compactSave(save))
```

Prefer putting reusable rules in `src/lib/game/*.ts` (or `actions.ts`) so AI and UI stay in sync.

### 8.3 AI pulse

```
Settings: aiEnabled, aiPulsesPerHour, aiActorsPerPulse
  → simScheduler / catchUpAi
  → ai.ts runAiBrain (chunked)
  → optional mind LLM plan
```

### 8.4 Combat power (simplified)

```
Strike  ≈ units + weapons + tech + mothership.power (+ social/planet/ascension)
Defence ≈ units + weapons + tech + mothershipDefenceBonus (+ fleet cluster)
```

Attack rank protection: see `ATTACK_RANK_BELOW_FRACTION` in `rankings.ts`  
(band = 10% of **living ladder**, not 10% of your rank number).

---

## 9. Game systems index

Quick pointers when you need to change behavior:

| Want to change… | Start here |
|-----------------|------------|
| Save shape / version | `schema.ts`, `localStore.ts` |
| AI count on new game | `seed.ts` (`TARGET_AI_COUNT`) |
| Turn income / regen | `turns.ts`, `economy.ts` |
| Attack / raid math | `combat.ts` |
| Covert ops | `covert.ts` |
| Who AI attacks | `ai.ts`, `rankings.ts` (rank range) |
| Mothership power | `mothership.ts` + `/play/mothership` |
| Guild / war / eradicate | `guilds.ts`, `wars.ts` |
| Fleet cluster defence | `fleetClusters.ts` |
| Rankings refresh | `rankings.ts`, Settings UI |
| Market prices | `market.ts` |
| Ascension | `ascension.ts` |
| Race bonuses / weapons | `races.ts` |
| Visual stage theme | `gfx/stageThemes.ts`, `VectorStage.tsx` |
| Nav links | `GameShell.tsx` |
| LLM prompts | `mind.ts`, `forum.ts`, `aiWorldContext.ts` |

---

## 10. How to extend

### 10.1 Add a new play page

1. Create `src/app/play/my-feature/page.tsx` with `"use client"`.
2. Wrap content in `<PlayGate stageMode="…">` (add a theme in `stageThemes.ts` if new).
3. Add nav entry in `GameShell.tsx`.
4. Read/write via `useGame()` — add methods on `GameContext` if needed.

### 10.2 Add a player action

1. Implement pure mutation in `src/lib/game/<system>.ts` or `actions.ts`.
2. Expose through `GameContext` (clone save → mutate → `commit`).
3. Wire UI; if AI should use it, call the same helper from `ai.ts` / `mind.ts` executor.

### 10.3 Change mothership / economy constants

Edit formulas and costs in the owning module (`mothership.ts`, `economy.ts`).  
Update UI labels that hardcode effect text (e.g. mothership page `moduleEffectLabel`).

### 10.4 Schema migration checklist

```text
[ ] schema.ts types + SCHEMA_VERSION++
[ ] DEFAULT_* constants
[ ] localStore migrateRealm / migrate
[ ] seed.ts for new games
[ ] compactSave.ts if dead realms strip fields
[ ] UI + AI tolerate old saves
[ ] npx tsc --noEmit && npm run build
```

### 10.5 Adding an npm script

Add to `package.json` `"scripts"`, document it in **§4 Scripts** of this file and the README table.

---

## 11. Conventions & pitfalls

- **Path alias:** import with `@/lib/...`, `@/components/...`.
- **Client vs server:** anything using `better-sqlite3`, `fs`, or `llmQueue` stays under `app/api` or `lib/server`.
- **Mutations:** clone the save (`structuredClone`) before mutating in context methods; avoid mutating React state in place.
- **Performance:** AI and rankings are chunked (`simScheduler`) — don’t reintroduce sync O(N²) over all realms on every click.
- **Rankings cache:** UI/AI often read `save.rankingsCache`; force refresh from Settings when debugging ranks.
- **Next.js 16:** read `AGENTS.md` / `node_modules/next/dist/docs/` before assuming old App Router APIs.
- **Do not commit** `data/`, `.env*`, or huge SQLite WALs.
- **IP:** don’t add copyrighted Stargate franchise assets.

---

## 12. Troubleshooting

| Symptom | Likely fix |
|---------|------------|
| `better-sqlite3` fails to install | Install native build tools; use Node 20+; rebuild (`npm rebuild better-sqlite3`) |
| Save “missing” after wipe | Delete `data/` or use Settings reset; restart `npm run dev` |
| AI hangs / UI freezes | Lower `aiActorsPerPulse` in Settings; check simScheduler chunking |
| LLM never responds | Check `GATEWARS_LLM_*`, Settings URL, and `/api/forum/llm` errors |
| Types fail after schema change | Bump version, migrate defaults, run `npx tsc --noEmit` |
| Attack blocked “out of rank range” | Intended — see `rankings.ts` attack band (10% of living pool) |
| Port in use | `npx next dev -p 3001` |

---

## Related docs

- [`README.md`](README.md) — quick start for players
- [`docs/GATEWARS.md`](docs/GATEWARS.md) — design & classic systems
- [`AGENTS.md`](AGENTS.md) — Next.js agent guidance

When in doubt: find the system in **§9**, change the module, keep UI/AI/actions aligned, migrate schema if the save shape moved, then `tsc` + `build`.
