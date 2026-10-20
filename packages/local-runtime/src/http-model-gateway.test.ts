import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { HttpModelGateway } from "./http-model-gateway.js";

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ baseUrl: string; server: ReturnType<typeof createServer> }> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server has no port");
  return { baseUrl: `http://127.0.0.1:${address.port}`, server };
}

function bodyOf(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

describe("http model gateway", () => {
  it("streams SSE text frames with auth and request body", async () => {
    let seenAuth = "";
    let seenBody = "";
    const { baseUrl } = await listen(async (request, response) => {
      seenAuth = String(request.headers.authorization);
      seenBody = await bodyOf(request);
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write('event: text\ndata: {"text":"Hello "}\n\n');
      response.write('event: text\ndata: {"text":"world"}\n\n');
      response.end("event: done\ndata: {}\n\n");
    });
    const gateway = new HttpModelGateway({
      baseUrl,
      getToken: () => "device-token",
    });

    const events: string[] = [];
    for await (const event of gateway.stream({
      botId: "bot-1",
      instructions: "Be concise.",
      messages: [{ role: "user", content: "Hi" }],
    })) {
      if (event.type === "text") events.push(event.text);
    }

    expect(events.join("")).toBe("Hello world");
    expect(seenAuth).toBe("Bearer device-token");
    expect(JSON.parse(seenBody)).toEqual({
      protocolVersion: 1,
      botId: "bot-1",
      instructions: "Be concise.",
      messages: [{ role: "user", content: "Hi" }],
    });
  });

  it("handles SSE frames split across network chunks", async () => {
    const { baseUrl } = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write('event: text\ndata: {"text":"par');
      response.write('tial"}\n\nevent: text\ndata: {"text":" done"}\n\n');
      response.end("event: done\ndata: {}\n\n");
    });
    const gateway = new HttpModelGateway({ baseUrl, getToken: () => "token" });
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

  it("surfaces gateway error frames", async () => {
    const { baseUrl } = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end('event: error\ndata: {"message":"quota exceeded"}\n\n');
    });
    const gateway = new HttpModelGateway({ baseUrl, getToken: () => "token" });
    const events = [];
    for await (const event of gateway.stream({
      botId: "bot",
      instructions: "",
      messages: [],
    })) {
      events.push(event);
    }
    expect(events).toContainEqual({ type: "error", message: "quota exceeded" });
  });

  it("throws on non-2xx responses", async () => {
    const { baseUrl } = await listen((_request, response) => {
      response.writeHead(402, { "content-type": "application/json" });
      response.end('{"error":"insufficient credits"}');
    });
    const gateway = new HttpModelGateway({ baseUrl, getToken: () => "token" });
    await expect(async () => {
      for await (const _event of gateway.stream({
        botId: "bot",
        instructions: "",
        messages: [],
      })) {
        // Consume the stream.
      }
    }).rejects.toThrow("Model gateway request failed (402)");
  });
});
