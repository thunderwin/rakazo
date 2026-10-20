# Bot templates

This directory holds server-side bot templates. Templates seed new bots; they
must not overwrite a user's later edits.

Each template should define:

- a stable `key`
- a `version`
- display name, title, and description
- `instructions`
- model provider and model id (when applicable)
- thinking level
- disabled builtin tools
- optional routines and initial message

The first implementation should use an idempotent seed script. A database-backed
template editor can come later.

Current status: **no production templates yet**. Add real templates only after
the prompt and tool policy are reviewed.
