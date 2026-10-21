# @rakazo/local-db

Local-first SQLite storage for the desktop runtime.

```ts
import { openLocalDatabase } from "@rakazo/local-db";

const db = openLocalDatabase("/path/to/rakazo.sqlite");
const bot = db.bots.create({ name: "Researcher" });
const thread = db.threads.getOrCreateForBot(bot.id);
db.messages.append({
  threadId: thread.id,
  role: "user",
  blocks: [{ kind: "text", text: "Hello" }],
});
await db.backupTo("/path/to/rakazo.backup.sqlite");
db.close();
```

The package uses `better-sqlite3` with WAL mode, foreign keys, a busy timeout, and
versioned migrations. One local runtime process should own the write connection;
renderers should use IPC instead of opening the database directly.

Current schema: bots, threads, messages, group chats/members/threads/messages,
runs, tool runs, settings, routines, and migrations.
