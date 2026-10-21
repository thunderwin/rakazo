import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { fetchClientManifest, verifyClientManifest } from "./client-manifest-sync.js";

const content = {
  name: "Example Company",
  minimumClientVersion: "0.3.0",
  botTemplates: [],
  groupPresets: [],
  knowledge: [],
  skills: [],
  routines: [],
  featurePolicy: { disabledTools: [], allowComputerUse: false },
};

describe("client manifest sync", () => {
  it("authenticates and validates the returned manifest", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        manifest: {
          organization: { id: "org-1", name: "Example Company" },
          version: 2,
          hash: "abc",
          publishedAt: "2026-10-21T00:00:00.000Z",
          signature: null,
          content,
        },
      }),
    );

    await expect(
      fetchClientManifest({
        serverUrl: "https://api.example.com",
        token: "session-token",
        fetchImpl,
      }),
    ).resolves.toMatchObject({ version: 2, content: { name: "Example Company" } });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.com/v1/client/manifest",
      expect.objectContaining({
        headers: { authorization: "Bearer session-token" },
      }),
    );
  });

  it("returns null when no organization manifest is assigned", async () => {
    await expect(
      fetchClientManifest({
        serverUrl: "https://api.example.com",
        token: "session-token",
        fetchImpl: async () => Response.json({ manifest: null }),
      }),
    ).resolves.toBeNull();
  });

  it("verifies signed manifests and rejects tampering", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const unsigned = {
      organization: { id: "org-1", name: "Example Company" },
      version: 2,
      hash: "abc",
      publishedAt: "2026-10-21T00:00:00.000Z",
      signature: null,
      content,
    };
    const { signature: _signature, ...payload } = unsigned;
    const signature = sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString(
      "base64url",
    );
    const manifest = { ...unsigned, signature };
    const encodedPublicKey = publicKey.export({ format: "der", type: "spki" }).toString("base64");

    expect(verifyClientManifest(manifest, encodedPublicKey)).toBe(true);
    expect(
      verifyClientManifest(
        { ...manifest, content: { ...manifest.content, name: "Tampered" } },
        encodedPublicKey,
      ),
    ).toBe(false);
  });
});
