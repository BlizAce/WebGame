# GateWars (webWars)

Local remake of **GateWars** (formerly StarGateWars): a turn-based sci-fi PBBG with realm management, PvP vs living AI rivals, guilds, markets, motherships, and a procedural vector gate stage.

**Stack:** Next.js 16 · React 19 · TypeScript · SQLite (`better-sqlite3`) · Canvas vector visuals  
**Persistence:** game state lives in `data/gatewars.sqlite` via `/api/save` (legacy browser saves migrate once on boot).

## Quick start

**Linux / macOS**

```bash
chmod +x scripts/setup.sh scripts/launch.sh
./scripts/setup.sh          # Ubuntu & Bazzite (nvm on immutable systems)
./scripts/launch.sh         # http://localhost:3000
```

**Windows**

```bat
scripts\setup.bat
scripts\launch.bat
```

Or if Node **20+** is already installed:

```bash
npm install
npm run dev                 # or: npm run launch / npm run launch:win
```

Open [http://localhost:3000](http://localhost:3000), create a realm, and play.

## What you get

- Four races with bonuses (Asgard, Goa'uld, Replicator, Tau'ri)
- Turn economy: Naquadah, Untrained Units, attack turns, covert capacity
- Training, Armory, Technology, Bank/Vault, Market
- Attack / Raid / Spy / Sabotage / Assassinate / Eradicate
- Mothership bay (Gate Wars–style capacity + fitted weapons/shields)
- Guilds, wars, fleet clusters, planets, rankings, ascension
- Living AI population with optional LLM minds / forum / mail
- Attack & intelligence logs, vacation mode, export/import
- Animated vector gate field (procedural canvas stage)

## Scripts

| Command | What it does |
|---------|----------------|
| `npm run setup` | Runs `scripts/setup.sh` (Node + `npm install` + smoke build) |
| `npm run setup:win` | Runs `scripts/setup.bat` (Windows; winget Node LTS if needed) |
| `npm run launch` | Runs `scripts/launch.sh` (dev server; installs deps if missing) |
| `npm run launch:win` | Runs `scripts/launch.bat` (Windows launcher) |
| `npm run dev` | Next.js development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint (Next core-web-vitals + TypeScript) |

## Docs

| Doc | Audience |
|-----|----------|
| [`DEV.md`](DEV.md) | **Developers** — stack, deps, scripts, codebase map, how to extend |
| [`docs/GATEWARS.md`](docs/GATEWARS.md) | Design notes & classic GateWars mechanics mapping |
| [`AGENTS.md`](AGENTS.md) | Cursor / agent notes for this Next.js version |

## Optional LLM

AI minds, forum posts, and mail can call an OpenAI-compatible endpoint. Configure in **Settings** or via env:

```bash
export GATEWARS_LLM_BASE_URL="http://127.0.0.1:11434/v1"
export GATEWARS_LLM_MODEL="llama3.2"
export GATEWARS_LLM_API_KEY=""   # if required
```

The game runs fully without an LLM; AI falls back to heuristic brains.

## License / IP

This is a fan remake inspired by GateWars gameplay systems. Avoid shipping copyrighted Stargate media assets; prefer original or GateWars-style naming.
