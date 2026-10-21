# @rakazo/local-runtime

Provider-neutral orchestration for the desktop client's local-first Agent.

The package exposes three boundaries:

- `LocalAgentEngine` runs one provider-neutral Agent loop.
- `LocalConversationStore` persists bots, threads, and messages; SQLite is the
  current implementation.
- `LocalToolProvider` exposes tool schemas, bot-level filters, and execution
  behind an approval gate.

Electron composes these ports with the existing Pi runtime in
`apps/desktop/src/pi-local-agent-engine.ts`. The Pi adapter points at the
operator's OpenAI-compatible model gateway with the current Better Auth session
token, while the Agent loop and tool results stay on the device.

Current implementation:

- local Pi Agent loop, including tool calls and tool results
- `shell` tool scoped to the local workspace, with one-time Electron approval
- `list_files`, `read_file`, and `write_file` with workspace containment and
  approval only for writes
- `run_subagent` through the existing Pi nested-agent loop
- persistent `message_bot` delegation with a bounded bot chain and local
  request/reply records
- local 2–10 bot group chats with shared threads, mentions, persisted
  `handoff_to_bot` events, cycle prevention, and a six-hop limit
- browser extension tools backed by a loopback Chrome/Edge bridge
- live run events and cancellation in the desktop IPC bridge
- local run/tool activity records exposed through the desktop IPC bridge
- SQLite bot/thread/message/settings persistence
- account-local theme, send-key, default-model, and bot configuration settings
- bot template loading and idempotent seeding

App launch, memory, and routines are still separate migration work.
