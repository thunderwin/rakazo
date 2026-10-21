import type { LocalTool } from "./tools.js";

const authSchema = {
  oneOf: [
    {
      type: "object",
      properties: { type: { const: "bearer" } },
      required: ["type"],
    },
    {
      type: "object",
      properties: {
        type: { const: "header" },
        name: { type: "string" },
      },
      required: ["type", "name"],
    },
    {
      type: "object",
      properties: {
        type: { const: "basic" },
        username: { type: "string" },
      },
      required: ["type", "username"],
    },
    {
      type: "object",
      properties: { type: { const: "login" } },
      required: ["type"],
    },
    {
      type: "object",
      properties: { type: { const: "command" } },
      required: ["type"],
    },
  ],
};

export interface LocalSecretToolActions {
  list(botId: string): Promise<unknown>;
  forget(botId: string, name: string): Promise<unknown>;
  request(botId: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
  requestFromUser(
    botId: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown>;
}

export function createLocalSecretTools(actions: LocalSecretToolActions): LocalTool[] {
  return [
    {
      definition: {
        name: "list_secrets",
        readOnly: true,
        requiresApproval: false,
        description:
          "List saved credential names and destinations for this bot. Values are never returned.",
        inputSchema: { type: "object", properties: {} },
      },
      async execute({ botId }) {
        if (!botId) throw new Error("Credential tools require a bot");
        return { credentials: await actions.list(botId) };
      },
    },
    {
      definition: {
        name: "forget_secret",
        requiresApproval: true,
        description: "Remove a saved credential so future requests cannot use it.",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
      async execute({ botId, args }) {
        if (!botId) throw new Error("Credential tools require a bot");
        return actions.forget(botId, typeof args.name === "string" ? args.name : "");
      },
    },
    {
      definition: {
        name: "secret_request",
        requiresApproval: true,
        description:
          "Make an HTTPS request using a saved credential. Authentication is added only at the saved origin; redirects are rejected and values are redacted from the response.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            url: { type: "string" },
            method: {
              type: "string",
              enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
            },
            body: { type: "string" },
            contentType: {
              type: "string",
              enum: ["application/json", "application/x-www-form-urlencoded", "text/plain"],
            },
          },
          required: ["name", "url"],
        },
      },
      async execute({ botId, args, signal }) {
        if (!botId) throw new Error("Credential tools require a bot");
        return actions.request(botId, args, signal);
      },
    },
    {
      definition: {
        name: "request_secret",
        requiresApproval: false,
        description:
          "Ask the user to enter a credential in a protected local dialog and optionally save it for this bot. Never ask the user to paste secrets into chat.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            origin: { type: "string" },
            auth: authSchema,
            reason: { type: "string" },
            replace: { type: "boolean" },
          },
          required: ["name", "origin", "auth"],
        },
      },
      async execute({ botId, args, signal }) {
        if (!botId) throw new Error("Credential tools require a bot");
        return actions.requestFromUser(botId, args, signal);
      },
    },
  ];
}
