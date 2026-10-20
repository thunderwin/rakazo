import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8"),
) as {
  productName?: string;
  build?: {
    productName?: string;
    appId?: string;
    publish?: Array<{ provider?: string; owner?: string; repo?: string }>;
  };
};

describe("desktop package metadata", () => {
  it("shares the customer-facing name between Electron and electron-builder", () => {
    expect(packageJson.productName).toBe("ericBot");
    expect(packageJson.build?.productName).toBeUndefined();
  });

  it("publishes updates from this fork rather than upstream", () => {
    expect(packageJson.build?.appId).toBe("com.ericbot.desktop");
    expect(packageJson.build?.publish).toEqual([
      { provider: "github", owner: "thunderwin", repo: "rakazo" },
    ]);
  });
});
