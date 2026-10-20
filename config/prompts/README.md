# Product prompts

Use this directory for product-level prompt fragments bundled with the client
and injected by the local runtime. Per-bot role prompts belong in
`config/bot-templates/`, not here.

Rules:

- Keep prompts versioned and reviewed like code.
- Do not treat prompts as a security boundary. Enforce tool access and approvals
  in the local runtime, and enforce account/credit limits on the server.
- Do not place secrets or customer data in prompts.

Current status: **no product prompts yet**.
