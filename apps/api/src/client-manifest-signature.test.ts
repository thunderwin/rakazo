import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createClientManifestSigner } from "./client-manifest-signature.js";

describe("client manifest signing", () => {
  it("produces a signature that the matching public key verifies", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const signer = createClientManifestSigner(
      privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    );
    const manifest = {
      organization: { id: "org-1", name: "Example Company" },
      version: 1,
      hash: "abc",
      publishedAt: "2026-10-21T00:00:00.000Z",
      signature: null,
      content: {
        name: "Example Company",
        minimumClientVersion: "0.3.0",
        botTemplates: [],
        groupPresets: [],
        knowledge: [],
        skills: [],
        routines: [],
        featurePolicy: { disabledTools: [], allowComputerUse: false },
      },
    };
    const signature = signer(manifest);
    const { signature: _signature, ...payload } = { ...manifest, signature };

    expect(
      verify(
        null,
        Buffer.from(JSON.stringify(payload)),
        publicKey,
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
  });
});
