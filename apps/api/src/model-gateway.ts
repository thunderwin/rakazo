interface GatewayMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelGatewayOptions {
  enabled: boolean;
  provider: string;
  model: string;
  apiKey?: string;
  userId: string;
  fetchImpl?: typeof fetch;
}

interface GatewayRequest {
  protocolVersion: 1;
  botId: string;
  instructions: string;
  thinkingLevel?: string;
  messages: GatewayMessage[];
}

const MAX_MESSAGES = 200;
const MAX_CONTENT_LENGTH = 100_000;

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function parseGatewayRequest(value: unknown): GatewayRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (body.protocolVersion !== 1 || typeof body.botId !== "string" || !body.botId.trim()) {
    return null;
  }
  if (typeof body.instructions !== "string" || body.instructions.length > MAX_CONTENT_LENGTH) {
    return null;
  }
  if (!Array.isArray(body.messages) || body.messages.length > MAX_MESSAGES) return null;
  const messages: GatewayMessage[] = [];
  for (const raw of body.messages) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const message = raw as Record<string, unknown>;
    if (
      (message.role !== "system" && message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string" ||
      message.content.length > MAX_CONTENT_LENGTH
    ) {
      return null;
    }
    messages.push({ role: message.role, content: message.content });
  }
  return {
    protocolVersion: 1,
    botId: body.botId.trim(),
    instructions: body.instructions,
    ...(typeof body.thinkingLevel === "string"
      ? { thinkingLevel: body.thinkingLevel.slice(0, 40) }
      : {}),
    messages,
  };
}

function sse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

interface OpenRouterChunk {
  choices?: Array<{ delta?: { content?: unknown }; finish_reason?: unknown }>;
  usage?: unknown;
}

async function streamOpenRouter(
  response: Response,
  onUsage?: (usage: unknown) => void,
): Promise<ReadableStream<Uint8Array>> {
  if (!response.body) throw new Error("Model provider returned no response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let closed = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = "";
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        controller.enqueue(sse("done", {}));
        controller.close();
        closed = true;
      };
      try {
        while (!done) {
          const { done: streamDone, value } = await reader.read();
          if (streamDone) break;
          buffer += decoder.decode(value, { stream: true });
          let newline = buffer.indexOf("\n");
          while (newline >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") {
              finish();
              break;
            }
            let chunk: OpenRouterChunk;
            try {
              chunk = JSON.parse(data) as OpenRouterChunk;
            } catch {
              continue;
            }
            const text = chunk.choices?.[0]?.delta?.content;
            if (typeof text === "string" && text.length > 0) {
              controller.enqueue(sse("text", { text }));
            }
            if ("usage" in chunk) onUsage?.(chunk.usage);
          }
        }
        finish();
      } catch (error) {
        if (!closed) {
          controller.enqueue(
            sse("error", {
              message: error instanceof Error ? error.message : "Model gateway stream failed",
            }),
          );
          controller.close();
          closed = true;
        }
      } finally {
        reader.releaseLock();
      }
    },
    cancel(reason) {
      closed = true;
      return reader.cancel(reason);
    },
  });
}

/**
 * Minimal V1 OpenAI-compatible gateway. It intentionally uses only the
 * deployment model and key; user/model selection is server-controlled.
 */
export async function modelGatewayResponse(
  request: Request,
  options: ModelGatewayOptions,
): Promise<Response> {
  if (!options.enabled) return jsonError(503, "Model gateway is disabled");
  if (options.provider !== "openrouter") {
    return jsonError(503, "Model gateway currently supports OpenRouter only");
  }
  if (!options.model || !options.apiKey) {
    return jsonError(503, "Deployment model is not configured");
  }

  let input: GatewayRequest | null;
  try {
    input = parseGatewayRequest(await request.json());
  } catch {
    return jsonError(400, "Invalid JSON");
  }
  if (!input) return jsonError(400, "Invalid gateway request");

  const fetchImpl = options.fetchImpl ?? fetch;
  const upstream = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
      "x-title": "Rakazo Local",
    },
    body: JSON.stringify({
      model: options.model,
      stream: true,
      messages: [
        ...(input.instructions ? [{ role: "system", content: input.instructions }] : []),
        ...input.messages,
      ],
      ...(input.thinkingLevel ? { reasoning: { effort: input.thinkingLevel } } : {}),
    }),
    signal: request.signal,
  }).catch((error: unknown) => {
    throw new Error(error instanceof Error ? error.message : "Model provider request failed");
  });

  if (!upstream.ok) {
    const status = upstream.status === 429 ? 429 : 502;
    return jsonError(status, "Model provider request failed");
  }

  return new Response(await streamOpenRouter(upstream), {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
