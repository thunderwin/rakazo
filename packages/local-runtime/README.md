# @rakazo/local-runtime

Minimal local runtime boundary for the desktop client.

It owns the local SQLite connection through `@rakazo/local-db`, creates a bot
thread, sends local conversation history to a `ModelGateway`, and persists the
assistant reply. The gateway is an interface so the desktop client can call the
operator's metered model gateway without embedding provider keys.

Current scope:

- text-only local chat
- HTTP model gateway client with SSE
- local runtime service for one desktop process
- bot template loading and idempotent seeding

Tool execution, browser bridging, and the Pi agent loop are the next milestones.
