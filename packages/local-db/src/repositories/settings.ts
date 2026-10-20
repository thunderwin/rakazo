import type Database from "better-sqlite3";
import type { JsonValue } from "../types.js";

interface SettingRow {
  key: string;
  value: string;
}

export class SettingsRepository {
  constructor(private readonly db: Database.Database) {}

  get(key: string): JsonValue | null {
    const row = this.db.prepare("SELECT key, value FROM settings WHERE key = ?").get(key) as
      | SettingRow
      | undefined;
    return row ? (JSON.parse(row.value) as JsonValue) : null;
  }

  set(key: string, value: JsonValue): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), new Date().toISOString());
  }
}
