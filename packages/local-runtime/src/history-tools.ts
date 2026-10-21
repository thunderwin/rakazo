import type { Bot, JsonValue, LocalDatabase } from "@rakazo/local-db";
import type { LocalAgentTool } from "./agent.js";
import type { LocalToolExecutionRequest, LocalToolProvider } from "./tools.js";

const historyTools: LocalAgentTool[] = [
  {
    name: "search_history",
    readOnly: true,
    requiresApproval: false,
    description:
      "Search older messages in the current bot or group thread. Returns message ids, roles, timestamps, and snippets.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["query"],
    },
  },
  {
    name: "read_history",
    readOnly: true,
    requiresApproval: false,
    description: "Read a full message returned by search_history.",
    inputSchema: {
      type: "object",
      properties: { message_id: { type: "string" } },
      required: ["message_id"],
    },
  },
];

function record(value: JsonValue): value is { [key: string]: JsonValue } {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function blockText(blocks: JsonValue[]): string {
  return blocks
    .map((block) => {
      if (!record(block)) return "";
      if (block.kind === "text" && typeof block.text === "string") return block.text;
      if (block.kind === "handoff" && typeof block.text === "string") return block.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function terms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .map((term) => term.trim())
        .filter(Boolean),
    ),
  ];
}

export class LocalHistoryToolProvider implements LocalToolProvider {
  constructor(
    private readonly tools: LocalToolProvider,
    private readonly db: LocalDatabase,
  ) {}

  async definitionsFor(bot: Bot): Promise<LocalAgentTool[]> {
    const disabled = new Set(bot.disabledBuiltinTools);
    return [
      ...(await this.tools.definitionsFor(bot)).filter(
        (tool) => !historyTools.some((candidate) => candidate.name === tool.name),
      ),
      ...historyTools.filter((tool) => !disabled.has(tool.name)),
    ];
  }

  async execute(request: LocalToolExecutionRequest): Promise<unknown> {
    if (request.name !== "search_history" && request.name !== "read_history") {
      return this.tools.execute(request);
    }
    if (!request.threadId) throw new Error("History tools need an active thread");
    const group = this.db.groupThreads.get(request.threadId);
    const messages = group
      ? this.db.groupMessages.list(request.threadId, 1_000)
      : this.db.messages.list(request.threadId, { limit: 1_000 });
    if (request.name === "read_history") {
      const id = typeof request.args.message_id === "string" ? request.args.message_id : "";
      const message = messages.find((candidate) => candidate.id === id);
      if (!message) return { error: "Message not found in this thread." };
      return {
        id: message.id,
        role: message.role,
        ...("botId" in message ? { botId: message.botId } : {}),
        createdAt: message.createdAt,
        text: blockText(message.blocks),
      };
    }
    const query = typeof request.args.query === "string" ? request.args.query.trim() : "";
    const queryTerms = terms(query);
    if (queryTerms.length === 0) return { results: [] };
    const requested = Number(request.args.limit ?? 5);
    const limit = Number.isFinite(requested) ? Math.min(20, Math.max(1, Math.trunc(requested))) : 5;
    const results = messages
      .map((message) => {
        const text = blockText(message.blocks);
        const lower = text.toLocaleLowerCase();
        const score = queryTerms.reduce(
          (total, term) =>
            total + (lower.includes(term) ? 1 + Math.min(8, lower.split(term).length - 1) : 0),
          0,
        );
        return { message, text, score };
      })
      .filter((entry) => entry.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          Date.parse(right.message.createdAt) - Date.parse(left.message.createdAt),
      )
      .slice(0, limit)
      .map(({ message, text }) => ({
        id: message.id,
        role: message.role,
        ...("botId" in message ? { botId: message.botId } : {}),
        createdAt: message.createdAt,
        snippet: text.slice(0, 320),
      }));
    return { results };
  }
}
