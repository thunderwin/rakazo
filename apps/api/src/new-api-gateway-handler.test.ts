import { describe, expect, it, vi } from "vitest";
import { handleNewApiGatewayRequest } from "./new-api-gateway-handler.js";

describe("New API gateway handler", () => {
  it("returns 401 before touching the New API adapter", async () => {
    const getIdentity = vi.fn();
    const response = await handleNewApiGatewayRequest(
      new Request("https://app.example.com/v1/model/openai/chat/completions", {
        method: "POST",
        body: "{}",
      }),
      "/v1/chat/completions",
      {
        newApiBaseUrl: "https://newapi.example.com",
        authenticate: async () => null,
        getIdentity,
      },
    );
    expect(response.status).toBe(401);
    expect(getIdentity).not.toHaveBeenCalled();
  });

  it("returns 503 when New API is not configured", async () => {
    const response = await handleNewApiGatewayRequest(
      new Request("https://app.example.com/v1/model/openai/chat/completions"),
      "/v1/chat/completions",
      {
        newApiBaseUrl: undefined,
        authenticate: async () => ({ userId: "user-1", spaceId: "space-1" }),
        getIdentity: async () => ({ token: "token" }),
      },
    );
    expect(response.status).toBe(503);
  });

  it("maps identity provisioning failure to a generic 502", async () => {
    const onIdentityError = vi.fn();
    const response = await handleNewApiGatewayRequest(
      new Request("https://app.example.com/v1/model/openai/chat/completions"),
      "/v1/chat/completions",
      {
        newApiBaseUrl: "https://newapi.example.com",
        authenticate: async () => ({ userId: "user-1", spaceId: "space-1" }),
        getIdentity: async () => {
          throw new Error("private upstream detail");
        },
        onIdentityError,
      },
    );
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain("Model gateway unavailable");
    expect(body).not.toContain("private upstream detail");
    expect(onIdentityError).toHaveBeenCalled();
  });
});
