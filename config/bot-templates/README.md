# Bot templates

This directory holds bot templates bundled with the desktop client. They are
seeded into the local SQLite database when a bot is created; the server must not
store user bot data. Templates must not overwrite a user's later edits.

Each template should define:

- a stable `key`
- a `version`
- display name, title, and description
- `instructions`
- model provider and model id (when applicable)
- thinking level
- disabled builtin tools
- optional routines and initial message

The first implementation should use an idempotent local seed script. A
server-delivered signed template pack can come later, but it must not become the
source of truth for user data.

Current status: **no production templates yet**. Add real templates only after
the prompt and tool policy are reviewed.
