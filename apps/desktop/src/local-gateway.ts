import { HttpModelGateway, type ModelGateway } from "@rakazo/local-runtime";

const unavailable: ModelGateway = {
  async *stream() {
    yield { type: "error", message: "Sign in to connect the model gateway." };
  },
};

/**
 * Development-only gateway selection. Production device tokens will come from
 * the authenticated desktop session; never ship the token in the bundle.
 */
export function createLocalGateway(
  env: { RAKAZO_MODEL_GATEWAY_URL?: string; RAKAZO_DEV_MODEL_GATEWAY_TOKEN?: string } = process.env,
): ModelGateway {
  const baseUrl = env.RAKAZO_MODEL_GATEWAY_URL?.trim();
  const token = env.RAKAZO_DEV_MODEL_GATEWAY_TOKEN?.trim();
  if (!baseUrl || !token) return unavailable;
  return new HttpModelGateway({ baseUrl, getToken: () => token });
}

export function createAuthenticatedGateway(
  serverUrl: string,
  getToken: () => Promise<string>,
): ModelGateway {
  return new HttpModelGateway({ baseUrl: serverUrl, getToken });
}
