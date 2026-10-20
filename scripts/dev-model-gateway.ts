import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const port = Number(process.env.DEV_GATEWAY_PORT ?? "8787");
const token = process.env.DEV_GATEWAY_TOKEN ?? "dev-token";

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sendData(response: ServerResponse, data: unknown) {
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/model/openai/chat/completions") {
    response.writeHead(404).end();
    return;
  }
  if (request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "invalid device token" }));
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(await readBody(request)) as unknown;
  } catch {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "invalid JSON" }));
    return;
  }
  const messages =
    typeof body === "object" && body !== null && "messages" in body
      ? (body.messages as Array<{ role?: string; content?: string }>)
      : [];
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const text = lastUser?.content ?? "(no user message)";

  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const id = "chatcmpl-dev";
  const base = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "dev-model",
  };
  sendData(response, {
    ...base,
    choices: [{ index: 0, delta: { role: "assistant", content: "Dev gateway received: " } }],
  });
  sendData(response, {
    ...base,
    choices: [{ index: 0, delta: { content: text } }],
  });
  sendData(response, {
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  });
  sendData(response, {
    ...base,
    choices: [],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
  response.write("data: [DONE]\n\n");
  response.end();
  console.log(`served ${text.split("\n")[0]}`);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`dev model gateway listening on http://127.0.0.1:${port}`);
  console.log("token is read from DEV_GATEWAY_TOKEN (default: dev-token)");
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
