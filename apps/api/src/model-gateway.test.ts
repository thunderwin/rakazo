import { describe, expect, it, vi } from "vitest";
import { type NewApiGatewayOptions, openAiCompatibleGatewayResponse } from "./model-gateway.js";

function options(fetchImpl: typeof fetch): NewApiGatewayOptions {
  return {
    newApiBaseUrl: "https://newapi.example.com",
    getToken: async () => "user-new-api-token",
    fetchImpl,
  };
}

function request(body: unknown, headers: HeadersInit = {}): Request {
  return new Request("https://app.example.com/v1/model/openai/chat/completions", {
    method: "POST",
    headers: {
      authorization: "Bearer better-auth-session",
      "content-type": "application/json",
      accept: "text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("OpenAI-compatible New API gateway", () => {
  it("forwards tool calls, forces usage, and replaces the client credential", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(url).toBe("https://newapi.example.com/v1/chat/completions");
      const headers = init?.headers as Headers;
      expect(headers.get("authorization")).toBe("Bearer user-new-api-token");
      expect(headers.get("content-type")).toBe("application/json");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.stream).toBe(true);
      expect(body.stream_options).toEqual({ include_usage: true });
      expect(body.tools).toEqual([
        { type: "function", function: { name: "shell", parameters: { type: "object" } } },
      ]);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(
        JSON.stringify({
          id: "chatcmpl-1",
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: { name: "shell", arguments: '{"command":"pwd"}' },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const response = await openAiCompatibleGatewayResponse(
      request({
        model: "model-a",
        stream: true,
        stream_options: { include_usage: false },
        tools: [{ type: "function", function: { name: "shell", parameters: { type: "object" } } }],
        messages: [{ role: "user", content: "run pwd" }],
      }),
      options(fetchImpl as typeof fetch),
      "/v1/chat/completions",
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"tool_calls"');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("proxies models and keeps the response body raw", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('{"object":"list","data":[{"id":"model-a"}]}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const modelsRequest = new Request("https://app.example.com/v1/model/openai/models", {
      method: "GET",
      headers: { authorization: "Bearer session" },
    });
    const response = await openAiCompatibleGatewayResponse(
      modelsRequest,
      options(fetchImpl as typeof fetch),
      "/v1/models",
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"model-a"');
  });

  it("maps New API quota errors to 402 and hides upstream details", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "private channel and provider detail",
              code: "insufficient_user_quota",
            },
          }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
    );
    const response = await openAiCompatibleGatewayResponse(
      request({ model: "model-a", messages: [] }),
      options(fetchImpl as typeof fetch),
      "/v1/chat/completions",
    );
    expect(response.status).toBe(402);
    const body = await response.text();
    expect(body).toContain("Insufficient credits");
    expect(body).not.toContain("private channel");
  });

  it.each([
    [401, 401],
    [403, 403],
    [429, 429],
    [500, 502],
  ])("maps upstream %i to %i", async (upstreamStatus, expectedStatus) => {
    const fetchImpl = vi.fn(
      async () => new Response("upstream detail", { status: upstreamStatus }),
    );
    const response = await openAiCompatibleGatewayResponse(
      request({ model: "model-a", messages: [] }),
      options(fetchImpl as typeof fetch),
      "/v1/chat/completions",
    );
    expect(response.status).toBe(expectedStatus);
  });

  it("rejects malformed JSON and oversized bodies", async () => {
    const fetchImpl = vi.fn();
    const malformed = await openAiCompatibleGatewayResponse(
      new Request("https://app.example.com/v1/model/openai/chat/completions", {
        method: "POST",
        body: "{",
      }),
      options(fetchImpl as typeof fetch),
      "/v1/chat/completions",
    );
    expect(malformed.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("cancels the upstream request when the client disconnects", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException("aborted", "AbortError"));
            return;
          }
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const upstream = openAiCompatibleGatewayResponse(
      new Request("https://app.example.com/v1/model/openai/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: "model-a", messages: [] }),
        signal: controller.signal,
      }),
      options(fetchImpl as typeof fetch),
      "/v1/chat/completions",
    );
    controller.abort();
    await expect(upstream).rejects.toMatchObject({ name: "AbortError" });
  });
});
