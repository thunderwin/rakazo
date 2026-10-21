import type {
  ClientManifestContent,
  ClientManifestEnvelope,
  ControlPlaneMember,
  ControlPlaneOrganization,
} from "@rakazo/contracts";

export interface AdminSession {
  userId: string;
  platformAdmin: boolean;
  organizations: ControlPlaneOrganization[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok) {
    throw new ApiError(body.error || "请求失败", response.status);
  }
  return body as T;
}

export function adminSession() {
  return api<AdminSession>("/v1/admin/control/me");
}

export async function signIn(email: string, password: string): Promise<void> {
  const response = await fetch("/api/auth/sign-in/email", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new ApiError(
      response.status === 401 ? "邮箱或密码错误。" : "登录失败。",
      response.status,
    );
  }
}

export function createOrganization(input: { name: string; slug: string; ownerEmail?: string }) {
  return api<ControlPlaneOrganization>("/v1/admin/control/organizations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function organizationMembers(organizationId: string) {
  return api<{ members: ControlPlaneMember[] }>(
    `/v1/admin/control/organizations/${encodeURIComponent(organizationId)}/members`,
  );
}

export function addOrganizationMember(
  organizationId: string,
  input: { email: string; role: "member" | "admin" },
) {
  return api<ControlPlaneMember>(
    `/v1/admin/control/organizations/${encodeURIComponent(organizationId)}/members`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function removeOrganizationMember(organizationId: string, userId: string) {
  return api<{ ok: true }>(
    `/v1/admin/control/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );
}

export function organizationManifest(organizationId: string) {
  return api<{ manifest: ClientManifestEnvelope | null }>(
    `/v1/admin/control/organizations/${encodeURIComponent(organizationId)}/manifest`,
  );
}

export function publishOrganizationManifest(
  organizationId: string,
  content: ClientManifestContent,
) {
  return api<ClientManifestEnvelope>(
    `/v1/admin/control/organizations/${encodeURIComponent(organizationId)}/manifest`,
    { method: "PUT", body: JSON.stringify(content) },
  );
}
