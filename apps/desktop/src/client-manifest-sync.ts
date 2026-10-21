import { createPublicKey, verify } from "node:crypto";
import { type ClientManifestEnvelope, ClientManifestEnvelopeSchema } from "@rakazo/contracts";

export async function fetchClientManifest(input: {
  serverUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<ClientManifestEnvelope | null> {
  const response = await (input.fetchImpl ?? fetch)(
    `${input.serverUrl.replace(/\/+$/, "")}/v1/client/manifest`,
    {
      headers: { authorization: `Bearer ${input.token}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(`Client manifest request failed (${response.status})`);
  const body = (await response.json().catch(() => null)) as { manifest?: unknown } | null;
  if (body?.manifest === null) return null;
  return ClientManifestEnvelopeSchema.parse(body?.manifest);
}

export function verifyClientManifest(
  manifest: ClientManifestEnvelope,
  encodedPublicKey: string,
): boolean {
  if (!manifest.signature) return false;
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(encodedPublicKey, "base64"),
      format: "der",
      type: "spki",
    });
    const { signature, ...payload } = manifest;
    return verify(
      null,
      Buffer.from(JSON.stringify(payload)),
      publicKey,
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}
