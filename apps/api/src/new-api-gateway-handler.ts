import { modelGatewayError, openAiCompatibleGatewayResponse } from "./model-gateway.js";

export type NewApiGatewayPath = "/v1/chat/completions" | "/v1/models";

export interface NewApiGatewayHandlerOptions {
  newApiBaseUrl: string | undefined;
  defaultModel?: string;
  authenticate: (request: Request) => Promise<{ userId: string; spaceId: string } | null>;
  getIdentity: (input: {
    userId: string;
    spaceId: string;
    request: Request;
  }) => Promise<{ token: string }>;
  onIdentityError?: (error: unknown) => void;
}

export async function handleNewApiGatewayRequest(
  request: Request,
  pathname: NewApiGatewayPath,
  options: NewApiGatewayHandlerOptions,
): Promise<Response> {
  const actor = await options.authenticate(request);
  if (!actor) return modelGatewayError(401, "Authentication required");
  if (!options.newApiBaseUrl) return modelGatewayError(503, "Model gateway is not configured");

  try {
    const identity = await options.getIdentity({
      userId: actor.userId,
      spaceId: actor.spaceId,
      request,
    });
    return await openAiCompatibleGatewayResponse(
      request,
      {
        newApiBaseUrl: options.newApiBaseUrl,
        ...(options.defaultModel ? { defaultModel: options.defaultModel } : {}),
        getToken: async () => identity.token,
      },
      pathname,
    );
  } catch (error) {
    options.onIdentityError?.(error);
    return modelGatewayError(502, "Model gateway unavailable");
  }
}
