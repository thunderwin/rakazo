export const BROWSER_BRIDGE_PROTOCOL_VERSION = 1;
export const BROWSER_BRIDGE_DEFAULT_PORT = 47_891;
export const BROWSER_BRIDGE_PORT_ATTEMPTS = 10;
export const BROWSER_BRIDGE_PATH = "/browser-bridge";

export type BrowserBridgeMethod =
  | "browser.list_tabs"
  | "browser.get_tab"
  | "browser.open"
  | "browser.navigate"
  | "browser.borrow_tab"
  | "browser.return_tab"
  | "browser.observe"
  | "browser.click"
  | "browser.type"
  | "browser.scroll"
  | "browser.close_session";

export interface BrowserBridgeRequest {
  type: "request";
  id: string;
  method: BrowserBridgeMethod;
  params: Record<string, unknown>;
}

export interface BrowserBridgeError {
  code: string;
  message: string;
}

export interface BrowserBridgeResponse {
  type: "response";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: BrowserBridgeError;
}

export interface BrowserBridgeClientInfo {
  name: "ericBot Browser Bridge";
  version: string;
}

export interface BrowserBridgePairHello {
  type: "pair";
  protocolVersion: number;
  code: string;
  client: BrowserBridgeClientInfo;
}

export interface BrowserBridgeTokenHello {
  type: "hello";
  protocolVersion: number;
  token: string;
  client: BrowserBridgeClientInfo;
}

export interface BrowserBridgeReady {
  type: "ready";
  protocolVersion: number;
}

export interface BrowserBridgePaired {
  type: "paired";
  protocolVersion: number;
  token: string;
}

export interface BrowserBridgeFailure {
  type: "error";
  code: string;
  message: string;
}

export interface BrowserBridgeKeepalive {
  type: "ping" | "pong";
}

export interface BrowserBridgeRevoked {
  type: "revoked";
}

export type BrowserBridgeHello =
  | BrowserBridgePairHello
  | BrowserBridgeTokenHello
  | BrowserBridgeReady
  | BrowserBridgePaired
  | BrowserBridgeFailure
  | BrowserBridgeKeepalive
  | BrowserBridgeRevoked;

export interface BrowserBridgeSessionParams {
  session_id: string;
}

export interface BrowserBridgeTabParams extends BrowserBridgeSessionParams {
  tab_id: number;
}

export interface BrowserBridgeOpenParams extends BrowserBridgeSessionParams {
  url: string;
}

export interface BrowserBridgeObserveParams extends BrowserBridgeSessionParams {
  max_elements?: number;
  max_text_chars?: number;
}

export interface BrowserBridgeRefParams extends BrowserBridgeSessionParams {
  ref: string;
}

export interface BrowserBridgeClickParams extends BrowserBridgeRefParams {}

export interface BrowserBridgeTypeParams extends BrowserBridgeRefParams {
  text: string;
  clear?: boolean;
  submit?: boolean;
}

export interface BrowserBridgeScrollParams extends BrowserBridgeSessionParams {
  ref?: string;
  delta_y?: number;
}

export interface BrowserTabSummary {
  tab_id: number;
  window_id: number;
  title: string;
  url: string;
  active: boolean;
}

export interface BrowserElementSummary {
  ref: string;
  role: string;
  name: string;
  tag: string;
  type?: string;
  disabled: boolean;
  checked?: boolean;
}

export interface BrowserObservation {
  observation_id: string;
  tab_id: number;
  title: string;
  url: string;
  text: string;
  elements: BrowserElementSummary[];
  truncated: boolean;
}

export interface BrowserActionOutcome {
  tab_id: number;
  title: string;
  url: string;
}

export interface BrowserBridgeStatus {
  available: boolean;
  connected: boolean;
  port: number | null;
  error: string | null;
  clientVersion: string | null;
}

export interface BrowserPairingOffer {
  port: number;
  code: string;
  expires_at: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isBrowserBridgeRequest(value: unknown): value is BrowserBridgeRequest {
  return (
    isRecord(value) &&
    value.type === "request" &&
    typeof value.id === "string" &&
    typeof value.method === "string" &&
    isRecord(value.params)
  );
}

export function isBrowserBridgeResponse(value: unknown): value is BrowserBridgeResponse {
  return (
    isRecord(value) &&
    value.type === "response" &&
    typeof value.id === "string" &&
    typeof value.ok === "boolean" &&
    (value.ok || isRecord(value.error))
  );
}

export function isBrowserBridgeHello(value: unknown): value is BrowserBridgeHello {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "error") {
    return typeof value.code === "string" && typeof value.message === "string";
  }
  if (value.type === "ready") {
    return typeof value.protocolVersion === "number";
  }
  if (value.type === "paired") {
    return (
      typeof value.protocolVersion === "number" &&
      typeof value.token === "string" &&
      value.token.length > 20
    );
  }
  if (value.type === "pair") {
    return (
      typeof value.protocolVersion === "number" &&
      typeof value.code === "string" &&
      isRecord(value.client) &&
      typeof value.client.version === "string"
    );
  }
  if (value.type === "hello") {
    return (
      typeof value.protocolVersion === "number" &&
      typeof value.token === "string" &&
      isRecord(value.client) &&
      typeof value.client.version === "string"
    );
  }
  return false;
}
