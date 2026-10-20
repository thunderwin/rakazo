export type GatewayRole = "system" | "user" | "assistant";

export interface GatewayMessage {
  role: GatewayRole;
  content: string;
}

export interface ModelGatewayRequest {
  botId: string;
  instructions: string;
  messages: GatewayMessage[];
  signal?: AbortSignal;
}

export type ModelGatewayEvent =
  | { type: "text"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface ModelGateway {
  stream(request: ModelGatewayRequest): AsyncIterable<ModelGatewayEvent>;
}
