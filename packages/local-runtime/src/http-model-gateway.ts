import type { ModelGateway, ModelGatewayEvent, ModelGatewayRequest } from "./model-gateway.js";

export interface HttpModelGatewayOptions {
  baseUrl: string;
  getToken: () => string | Promise<string>;
  /** Defaults to /v1/model/chat. */
  path?: string;
  fetch?: typeof fetch;
}

interface SseEvent {
  event: string;
  data: string;
}

function parseSseBlock(block: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  return { event, data: data.join("\n") };
}

function takeSseEvents(buffer: string): { events: SseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  return {
    events: parts.map(parseSseBlock).filter((event): event is SseEvent => event !== null),
    rest,
  };
}

function eventFromSse(event: SseEvent): ModelGatewayEvent | null {
  if (event.event === "done") return { type: "done" };
  if (event.event === "error") {
    let message = "Model gateway error";
    try {
      const parsed = JSON.parse(event.data) as { message?: unknown };
      if (typeof parsed.message === "string" && parsed.message.trim()) message = parsed.message;
    } catch {
      if (event.data.trim()) message = event.data.trim();
    }
    return { type: "error", message };
  }
  if (event.event !== "text" && event.event !== "message") return null;
  try {
    const parsed = JSON.parse(event.data) as unknown;
    if (typeof parsed === "string") return { type: "text", text: parsed };
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "text" in parsed &&
      typeof parsed.text === "string"
    ) {
      return { type: "text", text: parsed.text };
    }
  } catch {
    // A plain text SSE frame is valid too.
  }
  return { type: "text", text: event.data };
}

function gatewayUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

export class HttpModelGateway implements ModelGateway {
  private readonly baseUrl: string;
  private readonly path: string;
  private readonly getToken: () => string | Promise<string>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpModelGatewayOptions) {
    this.baseUrl = options.baseUrl;
    this.path = options.path ?? "/v1/model/chat";
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
      body: JSON.stringify({
        protocolVersion: 1,
        botId: request.botId,
        instructions: request.instructions,
        ...(request.model ? { model: request.model } : {}),
        ...(request.thinkingLevel ? { thinkingLevel: request.thinkingLevel } : {}),
        messages: request.messages,
      }),
      signal: request.signal,
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(
        `Model gateway request failed (${response.status})${detail ? `: ${detail}` : ""}`,
      );
    }
    if (!response.body) throw new Error("Model gateway returned no response body");

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(
        `Model gateway returned an unexpected response${detail ? `: ${detail}` : ""}`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = takeSseEvents(buffer);
        buffer = parsed.rest;
        for (const event of parsed.events) {
          const mapped = eventFromSse(event);
          if (mapped === null) continue;
          yield mapped;
          if (mapped.type === "done" || mapped.type === "error") return;
        }
      }

      buffer += decoder.decode();
      const tail = takeSseEvents(`${buffer}\n\n`);
      for (const event of tail.events) {
        const mapped = eventFromSse(event);
        if (mapped === null) continue;
        yield mapped;
        if (mapped.type === "done" || mapped.type === "error") return;
      }
    } finally {
      reader.releaseLock();
    }
  }
}
