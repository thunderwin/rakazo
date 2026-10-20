import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIModelGateway } from "./http-model-gateway.js";
import type { ModelGatewayEvent } from "./model-gateway.js";

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections?.();
        }),
    ),
  );
});

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server has no port");
  return `http://127.0.0.1:${address.port}/v1/model/openai`;
}

function bodyOf(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sse(response: ServerResponse, data: unknown) {
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

describe("OpenAI model gateway client", () => {
  it("streams text and preserves tool calls and usage", async () => {
    let seenAuth = "";
    let seenBody = "";
    const baseUrl = await listen(async (request, response) => {
      seenAuth = String(request.headers.authorization);
      seenBody = await bodyOf(request);
      response.writeHead(200, { "content-type": "text/event-stream" });
      sse(response, {
        id: "chatcmpl-1",
        choices: [{ index: 0, delta: { role: "assistant", content: "Hello " } }],
      });
      sse(response, {
        id: "chatcmpl-1",
        choices: [
          {
            index: 0,
            delta: {
              content: "world",
              tool_calls: [
                {
                  index: 0,
                  id: "call-1",
                  type: "function",
                  function: { name: "shell", arguments: '{"command":"pw' },
                },
              ],
            },
          },
        ],
      });
      sse(response, {
        id: "chatcmpl-1",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: 'd"}' } }],
            },
          },
        ],
        usage: { total_tokens: 4 },
      });
      response.end("data: [DONE]\n\n");
    });
    const gateway = new OpenAIModelGateway({
      baseUrl,
      getToken: () => "session-token",
    });
    const events: ModelGatewayEvent[] = [];
    for await (const event of gateway.stream({
      botId: "bot-1",
      instructions: "Be concise.",
      model: { provider: "openai-compatible", id: "model-a" },
      messages: [{ role: "user", content: "run pwd" }],
    })) {
      events.push(event);
    }

    expect(
      events
        .filter(
          (event): event is Extract<ModelGatewayEvent, { type: "text" }> => event.type === "text",
        )
        .map((event) => event.text)
        .join(""),
    ).toBe("Hello world");
    expect(events).toContainEqual({
      type: "tool_call",
      toolCall: {
        id: "call-1",
        type: "function",
        function: { name: "shell", arguments: '{"command":"pwd"}' },
      },
    });
    expect(events).toContainEqual({ type: "usage", usage: { total_tokens: 4 } });
    expect(seenAuth).toBe("Bearer session-token");
    expect(JSON.parse(seenBody)).toMatchObject({
      model: "model-a",
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "run pwd" },
      ],
    });
  });

  it("handles OpenAI SSE split across network chunks", async () => {
    const baseUrl = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write('data: {"choices":[{"delta":{"content":"par');
      response.write('tial"}}]}\n\ndata: {"choices":[{"delta":{"content":" done"}}]}\n\n');
      response.end("data: [DONE]\n\n");
    });
    const gateway = new OpenAIModelGateway({ baseUrl, getToken: () => "token" });
    let text = "";
    for await (const event of gateway.stream({
      botId: "bot",
      instructions: "",
      messages: [],
    })) {
      if (event.type === "text") text += event.text;
    }
    expect(text).toBe("partial done");
  });

  it("surfaces an OpenAI error frame", async () => {
    const baseUrl = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end('data: {"error":{"message":"quota exhausted"}}\n\n');
    });
    const gateway = new OpenAIModelGateway({ baseUrl, getToken: () => "token" });
    const events: ModelGatewayEvent[] = [];
    for await (const event of gateway.stream({
      botId: "bot",
      instructions: "",
      messages: [],
    })) {
      events.push(event);
    }
    expect(events).toContainEqual({ type: "error", message: "quota exhausted" });
  });

  it("throws on non-2xx responses", async () => {
    const baseUrl = await listen((_request, response) => {
      response.writeHead(403, { "content-type": "application/json" });
      response.end('{"error":{"message":"private detail"}}');
    });
    const gateway = new OpenAIModelGateway({ baseUrl, getToken: () => "token" });
    await expect(async () => {
      for await (const _event of gateway.stream({
        botId: "bot",
        instructions: "",
        messages: [],
      })) {
        // Consume the stream.
      }
    }).rejects.toThrow("Model gateway request failed (403)");
  });

  it("does not send a client Authorization header", async () => {
    const seen = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer server-session");
      return new Response("", { status: 500 });
    });
    const gateway = new OpenAIModelGateway({
      baseUrl: "https://app.example.com/v1/model/openai",
      getToken: () => "server-session",
      fetch: seen as typeof fetch,
    });
    await expect(async () => {
      for await (const _event of gateway.stream({
        botId: "bot",
        instructions: "",
        messages: [],
      })) {
        // Consume the stream.
      }
    }).rejects.toThrow();
  });
});
