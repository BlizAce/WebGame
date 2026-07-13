import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_VERSION } from "@/lib/db/schema";
import { compactSave } from "@/lib/db/compactSave";
import type { GameSave } from "@/lib/db/schema";

const SAVE_ID = "default";
const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "gatewars.sqlite");

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DB_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS saves (
      id TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);
  return db;
}

export function getSaveJson(): string | null {
  const row = getDb()
    .prepare(`SELECT data FROM saves WHERE id = ?`)
    .get(SAVE_ID) as { data: string } | undefined;
  return row?.data ?? null;
}

export function getSave(): GameSave | null {
  const json = getSaveJson();
  if (!json) return null;
  try {
    return JSON.parse(json) as GameSave;
  } catch {
    return null;
  }
}

export function putSave(save: GameSave): void {
  compactSave(save);
  save.schemaVersion = SCHEMA_VERSION;
  const json = JSON.stringify(save);
  getDb()
    .prepare(
      `INSERT INTO saves (id, schema_version, updated_at, data)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         schema_version = excluded.schema_version,
         updated_at = excluded.updated_at,
         data = excluded.data`,
    )
    .run(SAVE_ID, SCHEMA_VERSION, Date.now(), json);
}

export function putSaveJson(json: string): GameSave {
  let save: GameSave;
  try {
    save = JSON.parse(json) as GameSave;
  } catch {
    throw new Error("Invalid save JSON");
  }
  if (!save?.realms || !save.playerId) {
    throw new Error("Invalid save — missing realms or playerId");
  }
  putSave(save);
  return save;
}

export function clearSave(): void {
  getDb().prepare(`DELETE FROM saves WHERE id = ?`).run(SAVE_ID);
}

export function sqlitePath(): string {
  return DB_PATH;
}
