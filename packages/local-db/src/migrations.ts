import type Database from "better-sqlite3";

interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE bots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT 'blue',
        model_provider TEXT,
        model_id TEXT,
        thinking_level TEXT,
        disabled_builtin_tools TEXT NOT NULL DEFAULT '[]',
        template_key TEXT,
        template_version INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL UNIQUE REFERENCES bots(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'bot', 'system')),
        blocks TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (thread_id, sequence)
      );

      CREATE INDEX messages_thread_sequence
        ON messages(thread_id, sequence);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE routines (
        id TEXT PRIMARY KEY,
        bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        cron TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX routines_bot_id ON routines(bot_id);
    `,
  },
];

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => (row as { version: number }).version),
  );
  const record = db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)");

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.version, new Date().toISOString());
    })();
  }
}
