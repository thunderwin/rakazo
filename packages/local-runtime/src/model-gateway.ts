export type GatewayRole = "system" | "user" | "assistant";

export interface GatewayMessage {
  role: GatewayRole;
  content: string;
}

export interface ModelGatewayRequest {
  botId: string;
  instructions: string;
  model?: { provider: string; id: string };
  thinkingLevel?: string;
  messages: GatewayMessage[];
  signal?: AbortSignal;
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export type ModelGatewayEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; toolCall: OpenAIToolCall }
  | { type: "usage"; usage: unknown }
  | { type: "done" }
  | { type: "error"; message: string };

export interface ModelGateway {
  stream(request: ModelGatewayRequest): AsyncIterable<ModelGatewayEvent>;
}
