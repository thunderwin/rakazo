import type { LocalTool } from "./tools.js";

export interface LocalInteractionActions {
  ask: (question: string, options: string[], signal?: AbortSignal) => Promise<string | null>;
  message: (request: Parameters<LocalTool["execute"]>[0], text: string) => Promise<unknown>;
  takeover: (reason: string, signal?: AbortSignal) => Promise<boolean>;
}

export function createLocalInteractionTools(actions: LocalInteractionActions): LocalTool[] {
  return [
    {
      definition: {
        name: "request_takeover",
        requiresApproval: false,
        description:
          "Pause and ask the user to complete protected input, CAPTCHA, 2FA, payment, passkeys, or another step that requires a human.",
        inputSchema: {
          type: "object",
          properties: { reason: { type: "string", maxLength: 1_000 } },
          required: ["reason"],
        },
      },
      async execute({ args, signal }) {
        const reason = typeof args.reason === "string" ? args.reason.trim() : "";
        if (!reason || reason.length > 1_000) throw new Error("reason is invalid");
        if (!(await actions.takeover(reason, signal))) {
          throw new Error("Takeover was cancelled");
        }
        return { ok: true };
      },
    },
    {
      definition: {
        name: "ask_user",
        requiresApproval: false,
        description:
          "Ask the user one short multiple-choice question when a decision materially changes the work.",
        inputSchema: {
          type: "object",
          properties: {
            question: { type: "string", maxLength: 240 },
            options: {
              type: "array",
              items: { type: "string", minLength: 1, maxLength: 80 },
              minItems: 2,
              maxItems: 4,
            },
          },
          required: ["question", "options"],
        },
      },
      async execute({ args, signal }) {
        const question = typeof args.question === "string" ? args.question.trim() : "";
        const options = Array.isArray(args.options)
          ? [...new Set(args.options.filter((value): value is string => typeof value === "string"))]
          : [];
        if (!question || question.length > 240) throw new Error("question is invalid");
        if (options.length < 2 || options.length > 4) {
          throw new Error("Provide 2 to 4 answer options");
        }
        return { answer: await actions.ask(question, options, signal) };
      },
    },
    {
      definition: {
        name: "message_user",
        requiresApproval: false,
        description:
          "Post a short durable progress update to the current chat. Do not use it for the final answer.",
        inputSchema: {
          type: "object",
          properties: { message: { type: "string", maxLength: 2_000 } },
          required: ["message"],
        },
      },
      async execute(request) {
        const text = typeof request.args.message === "string" ? request.args.message.trim() : "";
        if (!text || text.length > 2_000) throw new Error("message is invalid");
        await actions.message(request, text);
        request.publishEvent?.({ type: "message", text });
        return { ok: true };
      },
    },
  ];
}
