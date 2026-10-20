import { type ModelGatewayEvent, OpenAIModelGateway } from "@rakazo/local-runtime";
import { describe, expect, it } from "vitest";
import { createLocalGateway } from "./local-gateway.js";

describe("desktop local gateway", () => {
  it("returns a clear error until a gateway is configured", async () => {
    const gateway = createLocalGateway({});
    const events: ModelGatewayEvent[] = [];
    for await (const event of gateway.stream({
      botId: "bot",
      instructions: "",
      messages: [],
    })) {
      events.push(event);
    }
    expect(events).toEqual([{ type: "error", message: "Sign in to connect the model gateway." }]);
  });

  it("uses the configured gateway when both values exist", () => {
    expect(
      createLocalGateway({
        RAKAZO_MODEL_GATEWAY_URL: "https://api.example.com",
        RAKAZO_DEV_MODEL_GATEWAY_TOKEN: "dev-token",
      }),
    ).toBeInstanceOf(OpenAIModelGateway);
  });
});
