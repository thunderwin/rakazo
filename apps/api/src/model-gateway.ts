const MAX_REQUEST_BYTES = 10 * 1024 * 1024;
const MAX_ERROR_BYTES = 8 * 1024;

export interface NewApiGatewayOptions {
  newApiBaseUrl: string;
  defaultModel?: string;
  getToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
}

export function modelGatewayError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        message,
        type: "new_api_error",
        code: "",
      },
    }),
    {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    },
  );
}

function upstreamUrl(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${pathname}`;
}

function errorCodeFromBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: unknown };
      code?: unknown;
    };
    const code = parsed.error?.code ?? parsed.code;
    return typeof code === "string" ? code : "";
  } catch {
    return "";
  }
}

function mapUpstreamError(status: number, body: string): Response {
  const code = errorCodeFromBody(body);
  if (
    status === 403 &&
    (code === "insufficient_user_quota" || code === "pre_consume_token_quota_failed")
  ) {
    return modelGatewayError(402, "Insufficient credits");
  }
  if (status === 401) return modelGatewayError(401, "Authentication required");
  if (status === 403) return modelGatewayError(403, "Access denied");
  if (status === 429) return modelGatewayError(429, "Rate limit exceeded");
  if (status === 413) return modelGatewayError(413, "Request too large");
  if (status >= 400 && status < 500) return modelGatewayError(400, "Invalid model request");
  return modelGatewayError(502, "Model gateway unavailable");
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
      if (result.length >= maxBytes) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return result.slice(0, maxBytes);
}

async function parseRequestObject(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_REQUEST_BYTES) throw new Error("Request too large");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_REQUEST_BYTES) throw new Error("Request too large");
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function forceStreamUsage(body: Record<string, unknown>): Record<string, unknown> {
  if (body.stream !== true) return body;
  const existing =
    typeof body.stream_options === "object" &&
    body.stream_options !== null &&
    !Array.isArray(body.stream_options)
      ? (body.stream_options as Record<string, unknown>)
      : {};
  return {
    ...body,
    stream_options: { ...existing, include_usage: true },
  };
}

async function forward(
  request: Request,
  pathname: string,
  options: NewApiGatewayOptions,
  body?: Record<string, unknown>,
): Promise<Response> {
  const token = await options.getToken();
  const headers = new Headers();
  headers.set("authorization", `Bearer ${token}`);
  headers.set("accept", request.headers.get("accept") ?? "*/*");
  if (body !== undefined) headers.set("content-type", "application/json");
  const upstream = await (options.fetchImpl ?? fetch)(
    upstreamUrl(options.newApiBaseUrl, pathname),
    {
      method: request.method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: request.signal,
    },
  );
  if (!upstream.ok) {
    return mapUpstreamError(upstream.status, await readBoundedBody(upstream, MAX_ERROR_BYTES));
  }
  const responseHeaders = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) responseHeaders.set("content-type", contentType);
  responseHeaders.set("cache-control", "no-store");
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function openAiCompatibleGatewayResponse(
  request: Request,
  options: NewApiGatewayOptions,
  pathname: "/v1/chat/completions" | "/v1/models",
): Promise<Response> {
  if (!options.newApiBaseUrl.trim())
    return modelGatewayError(503, "Model gateway is not configured");
  if (request.method === "GET" && pathname === "/v1/models") {
    return forward(request, pathname, options);
  }
  if (request.method !== "POST" || pathname !== "/v1/chat/completions") {
    return modelGatewayError(405, "Method not allowed");
  }
  let body: Record<string, unknown>;
  try {
    body = await parseRequestObject(request);
  } catch (error) {
    return modelGatewayError(400, error instanceof Error ? error.message : "Invalid model request");
  }
  if (
    options.defaultModel &&
    (body.model === undefined ||
      body.model === null ||
      body.model === "" ||
      body.model === "default")
  ) {
    body = { ...body, model: options.defaultModel };
  }
  return forward(request, pathname, options, forceStreamUsage(body));
}
