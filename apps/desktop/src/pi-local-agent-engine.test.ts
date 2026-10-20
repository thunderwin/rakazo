import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { AgentRunRequest, AgentRuntimeEvent } from "@rakazo/adapter-kit";
import { PiAgentRuntime } from "@rakazo/adapters/pi-runtime";
import type { LocalAgentRunRequest } from "@rakazo/local-runtime";
import { describe, expect, it, vi } from "vitest";
import { PiLocalAgentEngine, toPiRequest } from "./pi-local-agent-engine.js";

const request: LocalAgentRunRequest = {
  botId: "bot-1",
  threadId: "thread-1",
  runId: "run-1",
  sourceMessageId: "message-1",
  prompt: "Check the build.",
  instructions: "Be precise.",
  history: [{ role: "user", content: "Earlier message" }],
  tools: [
    {
      name: "shell",
      description: "Run a command.",
      inputSchema: { type: "object", properties: { command: { type: "string" } } },
    },
  ],
  model: {
    provider: "openai-compatible",
    id: "model-a",
    baseUrl: "https://gateway.example/v1/model/openai",
    apiKey: "session-token",
    allowPublicEndpoint: true,
    baseUrlIsExact: true,
    thinkingLevel: "medium",
  },
  executeTool: vi.fn(async () => ({ stdout: "ok" })),
};

describe("Pi local agent engine", () => {
  it("maps the local request to the existing Pi runtime contract", () => {
    expect(toPiRequest(request)).toMatchObject({
      botId: "bot-1",
      threadId: "thread-1",
      runId: "run-1",
      sourceMessageId: "message-1",
      prompt: "Check the build.",
      instructions: "Be precise.",
      history: request.history,
      tools: request.tools,
      model: request.model,
      contextStrategy: "current",
    });
  });

  it("streams Pi events without hiding usage", async () => {
    let seen: AgentRunRequest | undefined;
    const runtime = {
      async *run(next: AgentRunRequest): AsyncIterable<AgentRuntimeEvent> {
        seen = next;
        yield { type: "text", text: "Working" };
        yield {
          type: "usage",
          provider: "openai-compatible",
          model: "model-a",
          inputTokens: 1,
          outputTokens: 2,
        };
        yield { type: "done" };
      },
      abort: vi.fn(async () => undefined),
    };
    const engine = new PiLocalAgentEngine(runtime);
    const events = [];

    for await (const event of engine.run(request, { userId: "user-1" })) events.push(event);

    expect(seen).toEqual(toPiRequest(request));
    expect(events).toEqual([
      { type: "text", text: "Working" },
      {
        type: "usage",
        usage: {
          provider: "openai-compatible",
          model: "model-a",
          inputTokens: 1,
          outputTokens: 2,
        },
      },
      { type: "done" },
    ]);
  });

  it("delegates abort to Pi", async () => {
    const abort = vi.fn(async () => undefined);
    const engine = new PiLocalAgentEngine({
      async *run() {},
      abort,
    });

    await engine.abort("run-1");

    expect(abort).toHaveBeenCalledWith("run-1");
  });

  it("runs a real Pi tool loop against an offline OpenAI-compatible server", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const urls: string[] = [];
    const authorizations: Array<string | undefined> = [];
    const server = createServer(async (request, response) => {
      urls.push(request.url ?? "");
      authorizations.push(request.headers.authorization);
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      bodies.push(body);
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      const chunk = (payload: unknown) => {
        response.write(`data: ${JSON.stringify(payload)}\n\n`);
      };
      if (bodies.length === 1) {
        chunk({
          id: "chatcmpl-1",
          object: "chat.completion.chunk",
          model: "model-a",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "shell",
                      arguments: '{"command":"printf hello"}',
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        });
        chunk({
          id: "chatcmpl-1",
          object: "chat.completion.chunk",
          model: "model-a",
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        });
      } else {
        chunk({
          id: "chatcmpl-2",
          object: "chat.completion.chunk",
          model: "model-a",
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "The probe worked." },
              finish_reason: null,
            },
          ],
        });
        chunk({
          id: "chatcmpl-2",
          object: "chat.completion.chunk",
          model: "model-a",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        });
      }
      chunk({
        id: "chatcmpl-usage",
        object: "chat.completion.chunk",
        model: "model-a",
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      });
      response.end("data: [DONE]\n\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const executeTool = vi.fn(async () => ({ stdout: "hello", stderr: "", code: 0 }));
    const engine = new PiLocalAgentEngine(new PiAgentRuntime());

    try {
      const events = [];
      for await (const event of engine.run({
        ...request,
        model: {
          provider: "openai-compatible",
          id: "model-a",
          baseUrl: `http://127.0.0.1:${port}/v1/model/openai`,
          apiKey: "test-token",
          baseUrlIsExact: true,
        },
        executeTool,
      })) {
        events.push(event);
      }

      expect(bodies).toHaveLength(2);
      expect(urls).toEqual([
        "/v1/model/openai/chat/completions",
        "/v1/model/openai/chat/completions",
      ]);
      expect(authorizations).toEqual(["Bearer test-token", "Bearer test-token"]);
      expect(bodies[0]?.stream_options).toEqual({ include_usage: true });
      expect(bodies[0]?.tools).toEqual([
        expect.objectContaining({
          type: "function",
          function: expect.objectContaining({ name: "shell" }),
        }),
      ]);
      expect(bodies[1]?.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "tool",
            tool_call_id: "call-1",
            content: expect.stringContaining("hello"),
          }),
        ]),
      );
      expect(executeTool).toHaveBeenCalledOnce();
      expect(executeTool.mock.calls[0]?.slice(0, 3)).toEqual([
        "shell",
        { command: "printf hello" },
        expect.any(String),
      ]);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "tool", name: "shell" }),
          { type: "text", text: "The probe worked." },
          expect.objectContaining({ type: "done" }),
        ]),
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
