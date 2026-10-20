import { describe, expect, it } from "vitest";
import {
  BROWSER_BRIDGE_PROTOCOL_VERSION,
  isBrowserBridgeHello,
  isBrowserBridgeRequest,
  isBrowserBridgeResponse,
} from "./index.js";

describe("browser bridge protocol", () => {
  it("accepts a versioned pairing hello", () => {
    expect(
      isBrowserBridgeHello({
        type: "pair",
        protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
        code: "123456",
        client: { name: "ericBot Browser Bridge", version: "0.1.0" },
      }),
    ).toBe(true);
  });

  it("rejects malformed RPC frames", () => {
    expect(
      isBrowserBridgeRequest({
        type: "request",
        id: "request-1",
        method: "browser.observe",
        params: [],
      }),
    ).toBe(false);
    expect(
      isBrowserBridgeResponse({
        type: "response",
        id: "request-1",
        ok: false,
      }),
    ).toBe(false);
  });
});
