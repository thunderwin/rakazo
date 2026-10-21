import type { Bot, KnowledgeRepository, LocalKnowledgeDocument } from "@rakazo/local-db";
import type { LocalAgentTool } from "./agent.js";
import type { LocalToolExecutionRequest, LocalToolProvider } from "./tools.js";

export interface KnowledgeSearchResult {
  id: string;
  title: string;
  snippet: string;
  score: number;
  source: LocalKnowledgeDocument["source"];
}

const knowledgeTools: LocalAgentTool[] = [
  {
    name: "knowledge_search",
    readOnly: true,
    requiresApproval: false,
    description:
      "Search the user's local and organization knowledge library. Use when a request may depend on internal procedures, product facts, or reference documents.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords or a short question." },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "knowledge_read",
    readOnly: true,
    requiresApproval: false,
    description: "Read a knowledge document returned by knowledge_search.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Knowledge document id." },
      },
      required: ["id"],
    },
  },
];

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

function snippet(content: string, queryTerms: string[]): string {
  const lower = content.toLocaleLowerCase();
  const hits = queryTerms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);
  const start = Math.max(0, (hits[0] ?? 0) - 80);
  return content.slice(start, start + 280);
}

export class LocalKnowledge {
  constructor(private readonly repository: KnowledgeRepository) {}

  list(): LocalKnowledgeDocument[] {
    return this.repository.list();
  }

  get(id: string): LocalKnowledgeDocument | null {
    return this.repository.get(id);
  }

  create(input: { title: string; content: string }): LocalKnowledgeDocument {
    const title = input.title.trim();
    if (!title) throw new Error("Knowledge title is required");
    if (input.content.length > 500_000) throw new Error("Knowledge document is too large");
    return this.repository.create({ title, content: input.content });
  }

  update(id: string, input: { title?: string; content?: string }): LocalKnowledgeDocument {
    const title = input.title?.trim();
    if (title !== undefined && !title) throw new Error("Knowledge title is required");
    if ((input.content?.length ?? 0) > 500_000) {
      throw new Error("Knowledge document is too large");
    }
    const updated = this.repository.update(id, {
      ...(title === undefined ? {} : { title }),
      ...(input.content === undefined ? {} : { content: input.content }),
    });
    if (!updated) throw new Error("Knowledge document not found or read-only");
    return updated;
  }

  remove(id: string): boolean {
    return this.repository.remove(id);
  }

  search(query: string, limit = 5): KnowledgeSearchResult[] {
    const queryTerms = terms(query);
    if (queryTerms.length === 0) return [];
    return this.repository
      .list()
      .map((document) => {
        const title = document.title.toLocaleLowerCase();
        const content = document.content.toLocaleLowerCase();
        let score = 0;
        for (const term of queryTerms) {
          if (title.includes(term)) score += 5;
          score += Math.min(5, content.split(term).length - 1);
        }
        return {
          id: document.id,
          title: document.title,
          snippet: snippet(document.content, queryTerms),
          score,
          source: document.source,
        };
      })
      .filter((document) => document.score > 0)
      .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
      .slice(0, Math.max(1, Math.min(limit, 10)));
  }
}

export class LocalKnowledgeToolProvider implements LocalToolProvider {
  constructor(
    private readonly tools: LocalToolProvider,
    private readonly knowledge: LocalKnowledge,
  ) {}

  definitionsFor(bot: Bot): LocalAgentTool[] {
    const disabled = new Set(bot.disabledBuiltinTools);
    return [
      ...this.tools
        .definitionsFor(bot)
        .filter((tool) => tool.name !== "knowledge_search" && tool.name !== "knowledge_read"),
      ...knowledgeTools.filter((tool) => !disabled.has(tool.name)),
    ];
  }

  async execute(request: LocalToolExecutionRequest): Promise<unknown> {
    if (request.name === "knowledge_search") {
      const query = typeof request.args.query === "string" ? request.args.query : "";
      const limit = typeof request.args.limit === "number" ? request.args.limit : 5;
      return { results: this.knowledge.search(query, limit) };
    }
    if (request.name === "knowledge_read") {
      const id = typeof request.args.id === "string" ? request.args.id : "";
      const document = this.knowledge.get(id);
      return document
        ? {
            id: document.id,
            title: document.title,
            content: document.content,
            source: document.source,
          }
        : { error: "Knowledge document not found." };
    }
    return this.tools.execute(request);
  }
}
