import type { LocalTool } from "./tools.js";

const DEFAULT_FETCH_CHARS = 8_000;
const MAX_FETCH_CHARS = 50_000;
const DEFAULT_SEARCH_RESULTS = 5;
const MAX_SEARCH_RESULTS = 10;

export interface LocalWebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface LocalWebFetchResult {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
}

export interface LocalWebProvider {
  search?: (input: {
    query: string;
    maxResults: number;
    signal?: AbortSignal;
  }) => Promise<LocalWebSearchResult[]>;
  fetch?: (input: {
    url: string;
    maxChars: number;
    signal?: AbortSignal;
  }) => Promise<LocalWebFetchResult>;
}

export function createLocalWebTools(provider: LocalWebProvider): LocalTool[] {
  const tools: LocalTool[] = [];
  if (provider.search) {
    tools.push({
      definition: {
        name: "web_search",
        readOnly: true,
        requiresApproval: false,
        description:
          "Search the public web without an API key. Returns titles, URLs, and snippets. Follow with web_fetch to read a source.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query." },
            maxResults: {
              type: "number",
              description: "Maximum results (default 5, maximum 10).",
            },
          },
          required: ["query"],
        },
      },
      async execute({ args, signal }) {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query) throw new Error("query is required");
        const requested = Number(args.maxResults ?? DEFAULT_SEARCH_RESULTS);
        const maxResults = Number.isFinite(requested)
          ? Math.min(MAX_SEARCH_RESULTS, Math.max(1, Math.trunc(requested)))
          : DEFAULT_SEARCH_RESULTS;
        return {
          results: await provider.search!({ query, maxResults, signal }),
        };
      },
    });
  }
  if (provider.fetch) {
    tools.push({
      definition: {
        name: "web_fetch",
        readOnly: true,
        requiresApproval: false,
        description:
          "Fetch a public HTTP(S) page and return readable text without running JavaScript. Private and local network addresses are blocked.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "Public HTTP or HTTPS URL." },
            maxChars: {
              type: "number",
              description: "Maximum body characters (default 8000, maximum 50000).",
            },
          },
          required: ["url"],
        },
      },
      async execute({ args, signal }) {
        const url = typeof args.url === "string" ? args.url.trim() : "";
        if (!url) throw new Error("url is required");
        const requested = Number(args.maxChars ?? DEFAULT_FETCH_CHARS);
        const maxChars = Number.isFinite(requested)
          ? Math.min(MAX_FETCH_CHARS, Math.max(500, Math.trunc(requested)))
          : DEFAULT_FETCH_CHARS;
        return provider.fetch!({ url, maxChars, signal });
      },
    });
  }
  return tools;
}
