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

const buildScript = readFileSync(
  path.resolve(import.meta.dirname, "../scripts/build.mjs"),
  "utf8",
);

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

  it("supports build-time server and manifest verification configuration", () => {
    expect(buildScript).toContain("RAKAZO_BUILD_SERVER_URL");
    expect(buildScript).toContain("RAKAZO_BUILD_CLIENT_MANIFEST_PUBLIC_KEY");
    expect(buildScript).toContain('define["process.env.RAKAZO_SERVER_URL"]');
    expect(buildScript).toContain(
      'define["process.env.RAKAZO_CLIENT_MANIFEST_PUBLIC_KEY"]',
    );
  });
});
