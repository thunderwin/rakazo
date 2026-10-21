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
  {
    version: 2,
    sql: `
      CREATE TABLE peer_messages (
        id TEXT PRIMARY KEY,
        from_bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
        to_bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
        intent TEXT NOT NULL DEFAULT 'request',
        prompt TEXT NOT NULL,
        reply TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
        error TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX peer_messages_from_bot_created
        ON peer_messages(from_bot_id, created_at);
      CREATE INDEX peer_messages_to_bot_created
        ON peer_messages(to_bot_id, created_at);
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE chat_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT 'violet',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE group_members (
        group_id TEXT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
        bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (group_id, bot_id),
        UNIQUE (group_id, position)
      );

      CREATE INDEX group_members_bot_id ON group_members(bot_id);

      CREATE TABLE group_threads (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL UNIQUE REFERENCES chat_groups(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE group_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES group_threads(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'bot', 'system')),
        bot_id TEXT REFERENCES bots(id) ON DELETE SET NULL,
        blocks TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (thread_id, sequence)
      );

      CREATE INDEX group_messages_thread_sequence
        ON group_messages(thread_id, sequence);
      CREATE INDEX group_messages_bot_id ON group_messages(bot_id);
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
        bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
        group_id TEXT REFERENCES chat_groups(id) ON DELETE SET NULL,
        thread_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'stopped')),
        error TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT
      );

      CREATE INDEX runs_started_at ON runs(started_at DESC);
      CREATE INDEX runs_bot_started ON runs(bot_id, started_at DESC);
      CREATE INDEX runs_group_started ON runs(group_id, started_at DESC);

      CREATE TABLE tool_runs (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        execution_id TEXT NOT NULL,
        bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        arguments_json TEXT NOT NULL,
        result_json TEXT,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
        error TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        UNIQUE (run_id, execution_id)
      );

      CREATE INDEX tool_runs_run_started ON tool_runs(run_id, started_at);
      CREATE INDEX tool_runs_started_at ON tool_runs(started_at DESC);
    `,
  },
  {
    version: 5,
    sql: `
      CREATE TABLE memory_documents (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL CHECK (scope IN ('bot', 'user')),
        bot_id TEXT REFERENCES bots(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        content TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (
          (scope = 'bot' AND bot_id IS NOT NULL) OR
          (scope = 'user' AND bot_id IS NULL)
        )
      );

      CREATE UNIQUE INDEX memory_documents_scope_bot_path
        ON memory_documents(scope, COALESCE(bot_id, ''), path);
      CREATE INDEX memory_documents_scope_updated
        ON memory_documents(scope, updated_at DESC);

      CREATE TABLE memory_revisions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES memory_documents(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        content TEXT NOT NULL,
        source_run_id TEXT,
        source_thread_id TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (document_id, revision)
      );
    `,
  },
  {
    version: 6,
    sql: `
      ALTER TABLE routines ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';
      ALTER TABLE routines ADD COLUMN source TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE routines ADD COLUMN last_run_at TEXT;
      ALTER TABLE routines ADD COLUMN next_run_at TEXT;

      CREATE INDEX routines_enabled_next
        ON routines(enabled, next_run_at);

      CREATE TABLE routine_runs (
        id TEXT PRIMARY KEY,
        routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
        run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
        scheduled_for TEXT NOT NULL,
        trigger TEXT NOT NULL CHECK (trigger IN ('scheduled', 'missed', 'manual')),
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'stopped')),
        error TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (routine_id, scheduled_for)
      );

      CREATE INDEX routine_runs_routine_started
        ON routine_runs(routine_id, started_at DESC);
    `,
  },
  {
    version: 7,
    sql: `
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        bot_id TEXT REFERENCES bots(id) ON DELETE CASCADE,
        group_id TEXT REFERENCES chat_groups(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL CHECK (size > 0),
        content BLOB NOT NULL,
        created_at TEXT NOT NULL,
        CHECK (
          (bot_id IS NOT NULL AND group_id IS NULL) OR
          (bot_id IS NULL AND group_id IS NOT NULL)
        )
      );

      CREATE INDEX artifacts_bot_id ON artifacts(bot_id);
      CREATE INDEX artifacts_group_id ON artifacts(group_id);
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
