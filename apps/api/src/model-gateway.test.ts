import { describe, expect, it, vi } from "vitest";
import { type ModelGatewayOptions, modelGatewayResponse } from "./model-gateway.js";

const body = {
  protocolVersion: 1,
  botId: "bot-1",
  instructions: "Be concise.",
  messages: [{ role: "user", content: "Hello" }],
};

function options(overrides: Partial<ModelGatewayOptions> = {}): ModelGatewayOptions {
  return {
    enabled: true,
    provider: "openrouter",
    model: "openai/gpt-test",
    apiKey: "server-key",
    userId: "user-1",
    ...overrides,
  };
}

function request(value: unknown = body): Request {
  return new Request("http://api.example.test/v1/model/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

describe("model gateway", () => {
  it("proxies OpenRouter SSE text and sends a done event", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const upstream = JSON.parse(String(init?.body)) as {
        model: string;
        messages: unknown[];
      };
      expect(upstream.model).toBe("openai/gpt-test");
      expect(upstream.messages).toEqual([
        { role: "system", content: "Be concise." },
        { role: "user", content: "Hello" },
      ]);
      return new Response(
        [
          'data: {"choices":[{"delta":{"content":"Hello "}}]}',
          'data: {"choices":[{"delta":{"content":"world"}}]}',
          "data: [DONE]",
          "",
        ].join("\n\n"),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    });

    const response = await modelGatewayResponse(request(), {
      ...options(),
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toContain('event: text\ndata: {"text":"Hello "}');
  });

  it("rejects disabled and unconfigured gateways", async () => {
    expect((await modelGatewayResponse(request(), options({ enabled: false }))).status).toBe(503);
    expect((await modelGatewayResponse(request(), options({ apiKey: undefined }))).status).toBe(
      503,
    );
    expect((await modelGatewayResponse(request(), options({ provider: "anthropic" }))).status).toBe(
      503,
    );
  });

  it("maps provider rate limits to 429", async () => {
    const response = await modelGatewayResponse(request(), {
      ...options(),
      fetchImpl: vi.fn(async () => new Response("rate limited", { status: 429 })) as typeof fetch,
    });
    expect(response.status).toBe(429);
  });

  it("rejects malformed requests", async () => {
    expect((await modelGatewayResponse(request({}), options())).status).toBe(400);
  });
});
