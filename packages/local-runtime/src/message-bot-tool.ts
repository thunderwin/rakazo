import type { LocalTool } from "./tools.js";

export interface PeerBotMessageRequest {
  fromBotId: string;
  botId?: string;
  confirmName?: string;
  message: string;
  intent: "request" | "result" | "question" | "status" | "fyi";
  signal?: AbortSignal;
  peerChain?: string[];
}

export type DeliverPeerBotMessage = (request: PeerBotMessageRequest) => Promise<string>;

export function createMessageBotTool(deliver: DeliverPeerBotMessage): LocalTool {
  return {
    definition: {
      name: "message_bot",
      requiresApproval: false,
      description:
        "Send a useful request, question, status, or result to another of the user's persistent bots. Use bot_id from the teammate list, or confirm_name for an exact unique bot name. The recipient runs in its own thread and its reply is returned to this tool call.",
      inputSchema: {
        type: "object",
        properties: {
          bot_id: { type: "string" },
          confirm_name: { type: "string" },
          message: { type: "string" },
          intent: {
            type: "string",
            enum: ["request", "result", "question", "status", "fyi"],
          },
        },
        required: ["message"],
      },
    },
    async execute({ botId, args, signal, peerChain }) {
      if (!botId) throw new Error("message_bot requires a source bot");
      const targetId = typeof args.bot_id === "string" ? args.bot_id.trim() : undefined;
      const confirmName =
        typeof args.confirm_name === "string" ? args.confirm_name.trim() : undefined;
      const message = typeof args.message === "string" ? args.message.trim() : "";
      if (!message) throw new Error("message_bot message is required");
      const intent =
        args.intent === "result" ||
        args.intent === "question" ||
        args.intent === "status" ||
        args.intent === "fyi"
          ? args.intent
          : "request";
      return deliver({
        fromBotId: botId,
        ...(targetId ? { botId: targetId } : {}),
        ...(confirmName ? { confirmName } : {}),
        message,
        intent,
        signal,
        peerChain,
      });
    },
  };
}
