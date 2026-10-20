# Product prompts

Use this directory for product-level prompt fragments that are injected on the
server. Per-bot role prompts belong in `config/bot-templates/`, not here.

Rules:

- Keep prompts versioned and reviewed like code.
- Do not treat prompts as a security boundary. Enforce tool access, approvals,
  roles, and sandbox isolation in the server.
- Do not place secrets or customer data in prompts.

Current status: **no product prompts yet**.
