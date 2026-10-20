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
- SQLite bot/thread/message/settings persistence
- bot template loading and idempotent seeding

Files, app launch, browser bridging, memory, routines, and tool-run persistence
are still separate migration work.
