# AGENTS.md

- This is a public repository: assume all tracked content and diffs are public. Never commit secrets, `.env` files, private URLs, personal/customer data, or real production data; use fake placeholders. Review `git status` and the staged diff before committing, and never force-add ignored files. If private data appears, stop and alert the maintainer.
- Rakazo is one product across web, Electron desktop, and Expo mobile; Electron hosts the web UI. Put shared behavior, contracts, API logic, and reusable UI in packages. Keep only genuinely native navigation, storage, permissions, and interactions platform-specific. Core workflows must cover every applicable surface or degrade safely for an explicit reason.
- No hosted vendor is required to run the core product. Keep LLMs, sandboxes, memory, voice, integrations, and future external services optional and behind provider-neutral interfaces. Vendor SDKs, configuration, and translation belong only in adapters and composition roots. New providers must reuse shared contracts and deterministic offline conformance tests.
- Keep UI and copy minimal. Show advanced capability progressively and only when it becomes relevant; do not add explainer text that repeats the interface. Frontends express intent and render state; the backend owns orchestration, authorization, validation, retries, recovery, and provider translation. Give controls concise accessible names when needed.
- Treat every visible word as UI. Start UX work by asking what can be removed, and prefer progressive disclosure over persistent explanation or status chrome. If a PR adds user-facing copy, its description must quote the copy, explain why it is necessary, and say why removing it or revealing it only when relevant would not work.
- Configure compatible providers and models through shared connection settings and standard protocol capabilities; never add provider- or model-specific environment variables when the generic connection can express the behavior.
- Use top-level `import type`, never inline type imports. Reserve dynamic `import()` for necessary deferred loading.
- Keep code simple: reuse existing primitives and one source of truth, remove duplication and unused flexibility, and avoid speculative abstractions. Add an interface when it protects a real external or platform boundary, not for its own sake.
- Treat auth, secret handling, sandbox boundaries, host commands, and integrations as security-sensitive. Keep tests deterministic and offline by default.
- The desktop Playwright suite (`pnpm --filter @rakazo/desktop test:e2e`) opens real Electron windows and steals focus on macOS. Do not run it on a maintainer's machine as routine verification; run the unit tests locally and let CI's virtual-display job run the e2e on push.
- Marketing pages (the Astro site in `apps/www`) don't get tests. Check those changes visually and with a build, not with unit or E2E tests.
- After creating a pull request, stay with it until CI and automated review bots have finished; passing checks alone do not mean the review is complete. Follow `.agents/skills/pr-watch/SKILL.md`: run its `pr-digest --watch` helper as a single backgrounded call that blocks until the checks on the current head commit are terminal, then act on the verdict it prints. Do not poll in the foreground on a timer, which mostly buys repeated snapshots of an unchanged PR and dies at the tool timeout. Address every actionable issue, push the fixes, and repeat until no actionable feedback remains. Do not merge while review bots are still pending or review issues remain unresolved.
- PR descriptions say why the change exists, what changed, and how it was tested. Write Why as the product reason (what was wrong and what this changes); never "Elie wants" or a third-person briefing of a named person; the maintainer is the author.
- Commit messages, PR descriptions, issues, and review replies are public too. Describe test results in words instead of pasting tool output, and never include anything that identifies a person, machine, or account: local paths, usernames, hostnames, signing identities, legal entity names, Apple Team IDs, API key IDs, issuer or tenant IDs, account emails, or the accounts, machines, and files that secret values came from. Naming the secrets a workflow reads is fine; use placeholders when a value must be shown.
- For UI changes, link the CI E2E screenshot that shows the change on the PR; add the web test that opens that screen if it is missing. For native-only mobile UI that CI cannot capture, say so in the PR instead of linking an unrelated web screenshot.
- UI system. Colors live in `@rakazo/ui-tokens` as semantic tokens (background, card, muted, border, primary, destructive, ...) with one TypeScript source that generates `tokens.css`; never hardcode a product hex or use `[var(--…)]` arbitrary values. Web and Electron use shadcn/ui on Base UI, vendored into `packages/ui-web` via `pnpm exec shadcn add` from the official registry only (third-party registries are a supply-chain risk); reuse those components before writing chrome by hand, and reuse `apps/web/src/components/ai/` for AI moments (loading, shimmer, success). The app is monochrome: primary is ink, status colors are destructive/success/warning, bots carry the only identity color. Mobile is native-first: Expo Router, Expo UI, native sheets, menus, alerts and pickers wherever one exists; custom surfaces (thread, composer, avatars, cards) use plain StyleSheet with the shared tokens through `apps/mobile/lib/appearance`, and system chrome stays PlatformColor via `lib/native`. Mobile may diverge from web when the native pattern is better.
- On mobile, use built-in native iOS controls (@expo/ui SwiftUI and Liquid Glass, native header items, context menus, alerts, pickers, and switches) wherever possible instead of custom React Native pills or buttons.

## Fork-specific context

This checkout is a product fork of `elie222/rakazo`, maintained at
`thunderwin/rakazo`. The upstream project is the source of the agent runtime,
web UI, desktop shell, and sandbox providers. This fork is moving to a
single-device local-first product; it does not replace upstream behavior without
a documented reason.

The public product name is **ericBot**. Keep internal `@rakazo/*` package names,
API contracts, IPC names, and storage keys unchanged unless a migration is
explicitly planned.

Product intent:

- Users install a branded desktop client, sign up or sign in against the
  operator's server, and then run the Agent locally on that device.
- The server is a thin control plane: auth, billing/credits, model gateway,
  device registry, telemetry, crash reporting, and update feed. The model
  gateway is the intended revenue path.
- The client owns the Agent loop, tool execution, bot configuration,
  conversations, memory, routines, and the local SQLite database. The server
  must not store conversation content as business data.
- The client may ship a public server URL and brand assets. It must never ship
  an admin token, shared user credential, provider API key, database secret,
  encryption key, or sandbox supervisor token.
- V1 is single-device. Do not add multi-device sync, teams, shared computers,
  or mobile clients without a new documented decision.
- V1 ships as the desktop client only. Do not build or connect a separate web
  product unless a new decision expands the scope.
- Branding lives in `brand/` and `packages/ui-tokens`; generated icons and CSS
  are derived from those sources. Do not hand-edit generated assets.
- Per-bot prompts and configurations live in `config/bot-templates/` and are
  packaged with the client, then seeded into the local database when a bot is
  created. The server may deliver signed template updates, but must not store
  user bot data.

Read these before changing architecture, authentication, branding, or
onboarding:

- `docs/ARCHITECTURE.md` - current system boundaries and data flow.
- `docs/V1.md` - the accepted V1 scope and acceptance criteria.
- `docs/UPDATES.md` - update channels, signing, rollback, and local DB migration.
- `docs/MODEL_GATEWAY.md` - the client/server model gateway protocol.
- `docs/FORK.md` - fork strategy, customization points, and release pipeline.
- `docs/computer-runtime.md` - sandbox, terminal, and computer lifecycle.
- `docs/self-host.md` - deployment and operations.

Fork rules:

- Keep the upstream merge path viable. Prefer configuration and isolated brand
  modules over broad edits to upstream files. Record unavoidable core changes
  in `docs/FORK.md`.
- Use a top-level `serverUrl` build configuration for the operator's server;
  never derive it from untrusted runtime input.
- This fork's V1 intentionally uses the operator's hosted model gateway for
  metered model access. That is an accepted exception to upstream's
  "no hosted vendor required" default; keep provider SDKs behind the gateway.
- Treat local shell access, browser-extension permissions, device tokens, model
  gateway tokens, and provider credentials as security-sensitive. The model
  gateway sees prompts and responses; disclose that in the privacy policy.
- New API admin credentials and per-user API tokens are server-only. Never log a
  full New API key, and keep the New API relay body logger (`DEBUG=true`) off in
  production.
- Do not add server-side Agent execution or server-side conversation storage to
  V1. The local SQLite database is the source of truth.
- Never load unsigned remote code or configuration. Update manifests and
  runtime/config bundles must be signed and hash-verified. Keep the previous
  version for rollback, and never migrate the only local database in place.
- When behavior, configuration, or deployment changes, update the matching
  document in the same change. Mark unverified ideas as "planned" rather than
  describing them as current behavior.
