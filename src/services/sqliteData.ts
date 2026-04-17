import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import type { DataFile } from '../types/models.js';
import { ensureDir } from '../utils/fs.js';

const DATA_KEY = 'data_file';
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS app_data (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT
`;

let database: DatabaseSync | null = null;

function getDatabase(): DatabaseSync {
  if (!database) {
    database = new DatabaseSync(config.sqliteFilePath, { timeout: 5000 });
    database.exec(SCHEMA_SQL);
  }
  return database;
}

export async function initSqliteDataStore(): Promise<void> {
  await ensureDir(path.dirname(config.sqliteFilePath));
  getDatabase();
}

export async function readDataFromSqlite(): Promise<DataFile | null> {
  await initSqliteDataStore();
  const db = getDatabase();
  const row = db
    .prepare(
      `
        SELECT value
        FROM app_data
        WHERE key = ?
      `
    )
    .get(DATA_KEY) as { value: string } | undefined;

  if (!row) {
    return null;
  }

  return JSON.parse(row.value) as DataFile;
}

export async function writeDataToSqlite(data: DataFile): Promise<void> {
  await initSqliteDataStore();
  const db = getDatabase();
  db.prepare(
    `
      INSERT INTO app_data (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `
  ).run(DATA_KEY, JSON.stringify(data), new Date().toISOString());
}
