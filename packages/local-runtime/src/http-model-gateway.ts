import type {
  ModelGateway,
  ModelGatewayEvent,
  ModelGatewayRequest,
  OpenAIToolCall,
} from "./model-gateway.js";

export interface OpenAIModelGatewayOptions {
  /** OpenAI-compatible base URL, e.g. https://server.example.com/v1/model/openai. */
  baseUrl: string;
  getToken: () => string | Promise<string>;
  /** Defaults to /chat/completions. */
  path?: string;
  fetch?: typeof fetch;
}

interface OpenAIToolCallDelta {
  index?: unknown;
  id?: unknown;
  type?: unknown;
  function?: { name?: unknown; arguments?: unknown };
}

interface OpenAIChunk {
  choices?: Array<{
    delta?: {
      content?: unknown;
      tool_calls?: OpenAIToolCallDelta[];
    };
    finish_reason?: unknown;
  }>;
  usage?: unknown;
  error?: { message?: unknown };
}

function gatewayUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

function requestBody(request: ModelGatewayRequest) {
  return {
    model: request.model?.id?.trim() || "default",
    messages: [
      ...(request.instructions ? [{ role: "system" as const, content: request.instructions }] : []),
      ...request.messages,
    ],
    stream: true,
    stream_options: { include_usage: true },
    ...(request.thinkingLevel && request.thinkingLevel !== "off"
      ? { reasoning_effort: request.thinkingLevel }
      : {}),
  };
}

function mergeToolCall(
  calls: Map<number, OpenAIToolCall>,
  index: number,
  delta: OpenAIToolCallDelta,
) {
  const current = calls.get(index) ?? {
    id: "",
    type: "function" as const,
    function: { name: "", arguments: "" },
  };
  if (typeof delta.id === "string") current.id = delta.id;
  if (delta.type === "function") current.type = "function";
  if (typeof delta.function?.name === "string") current.function.name = delta.function.name;
  if (typeof delta.function?.arguments === "string") {
    current.function.arguments += delta.function.arguments;
  }
  calls.set(index, current);
}

function eventFromChunk(
  chunk: OpenAIChunk,
  calls: Map<number, OpenAIToolCall>,
): ModelGatewayEvent[] {
  if (chunk.error) {
    return [
      {
        type: "error",
        message:
          typeof chunk.error.message === "string" ? chunk.error.message : "Model gateway error",
      },
    ];
  }
  const events: ModelGatewayEvent[] = [];
  for (const choice of chunk.choices ?? []) {
    const content = choice.delta?.content;
    if (typeof content === "string" && content.length > 0) {
      events.push({ type: "text", text: content });
    }
    const deltas = choice.delta?.tool_calls ?? [];
    for (const [position, delta] of deltas.entries()) {
      const index = typeof delta.index === "number" ? delta.index : position;
      mergeToolCall(calls, index, delta);
    }
  }
  if (chunk.usage !== undefined && chunk.usage !== null) {
    events.push({ type: "usage", usage: chunk.usage });
  }
  return events;
}

function flushToolCalls(calls: Map<number, OpenAIToolCall>): ModelGatewayEvent[] {
  return [...calls.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, toolCall]) => ({ type: "tool_call", toolCall }));
}

async function readBoundedText(response: Response): Promise<string> {
  if (!response.body) return "";
  const text = await response.text();
  return text.slice(0, 500);
}

export class OpenAIModelGateway implements ModelGateway {
  private readonly baseUrl: string;
  private readonly path: string;
  private readonly getToken: () => string | Promise<string>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAIModelGatewayOptions) {
    this.baseUrl = options.baseUrl;
    this.path = options.path ?? "/chat/completions";
    this.getToken = options.getToken;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async *stream(request: ModelGatewayRequest): AsyncIterable<ModelGatewayEvent> {
    const token = await this.getToken();
    const response = await this.fetchImpl(gatewayUrl(this.baseUrl, this.path), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify(requestBody(request)),
      signal: request.signal,
    });
    if (!response.ok) {
      const detail = await readBoundedText(response);
      throw new Error(
        `Model gateway request failed (${response.status})${detail ? `: ${detail}` : ""}`,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      const parsed = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }>;
        usage?: unknown;
      };
      const message = parsed.choices?.[0]?.message;
      if (typeof message?.content === "string" && message.content) {
        yield { type: "text", text: message.content };
      }
      if (Array.isArray(message?.tool_calls)) {
        for (const toolCall of message.tool_calls) {
          if (toolCall && typeof toolCall === "object") {
            yield { type: "tool_call", toolCall: toolCall as OpenAIToolCall };
          }
        }
      }
      if (parsed.usage !== undefined) yield { type: "usage", usage: parsed.usage };
      yield { type: "done" };
      return;
    }
    if (!response.body) throw new Error("Model gateway returned no response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const calls = new Map<number, OpenAIToolCall>();
    let buffer = "";
    let finished = false;

    const processData = (data: string): ModelGatewayEvent[] => {
      if (data === "[DONE]") return [];
      try {
        return eventFromChunk(JSON.parse(data) as OpenAIChunk, calls);
      } catch {
        return [{ type: "error", message: "Model gateway returned invalid streaming data" }];
      }
    };

    try {
      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") {
            for (const event of flushToolCalls(calls)) yield event;
            yield { type: "done" };
            finished = true;
            break;
          }
          for (const event of processData(data)) {
            yield event;
            if (event.type === "error") {
              finished = true;
            }
          }
        }
      }
      if (!finished) {
        for (const event of flushToolCalls(calls)) yield event;
        yield { type: "done" };
      }
    } finally {
      reader.releaseLock();
    }
  }
}
