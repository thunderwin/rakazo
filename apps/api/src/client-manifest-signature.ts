import { createPrivateKey, sign } from "node:crypto";
import type { ClientManifestEnvelope } from "@rakazo/contracts";

export function createClientManifestSigner(encodedPrivateKey: string) {
  const privateKey = createPrivateKey({
    key: Buffer.from(encodedPrivateKey, "base64"),
    format: "der",
    type: "pkcs8",
  });
  return (manifest: ClientManifestEnvelope): string => {
    const { signature: _signature, ...payload } = manifest;
    return sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString("base64url");
  };
}
