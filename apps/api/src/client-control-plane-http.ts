import type { ClientManifestEnvelope } from "@rakazo/contracts";
import { ClientManifestContentSchema } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import type { Hono } from "hono";
import { adminControlPlanePage } from "./admin-control-plane-page.js";
import {
  addOrganizationMember,
  adminClientManifest,
  ControlPlaneConflictError,
  ControlPlaneForbiddenError,
  ControlPlaneInvalidError,
  ControlPlaneNotFoundError,
  clientManifestForUser,
  createControlPlaneOrganization,
  isPlatformAdmin,
  listControlPlaneOrganizations,
  listOrganizationMembers,
  publishClientManifest,
  removeOrganizationMember,
} from "./client-control-plane.js";

export interface ControlPlaneSessionUser {
  userId: string;
  activeOrganizationId: string | null;
}

function errorResponse(error: unknown): Response {
  if (error instanceof ControlPlaneInvalidError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof ControlPlaneForbiddenError) {
    return Response.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof ControlPlaneConflictError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof ControlPlaneNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  return Response.json({ error: "Control-plane request failed." }, { status: 500 });
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ControlPlaneInvalidError("Invalid request.");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new ControlPlaneInvalidError(`${label} is invalid.`);
  }
  return value.trim();
}

function email(value: unknown): string {
  const parsed = text(value, "Email", 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed)) {
    throw new ControlPlaneInvalidError("Email is invalid.");
  }
  return parsed;
}

export function mountClientControlPlane(
  app: Hono,
  options: {
    prisma: PrismaClient;
    currentUser: (request: Request) => Promise<ControlPlaneSessionUser | null>;
    signManifest?: (manifest: ClientManifestEnvelope) => string;
  },
): void {
  app.get("/admin", (c) => {
    c.header("x-frame-options", "DENY");
    c.header("cache-control", "no-store");
    return c.html(adminControlPlanePage());
  });
  app.use("/v1/admin/control/*", async (c, next) => {
    const origin = c.req.header("origin");
    if (
      origin &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method) &&
      origin !== new URL(c.req.url).origin
    ) {
      return c.json({ error: "Cross-origin control-plane mutation rejected." }, 403);
    }
    await next();
  });

  async function requireUser(request: Request): Promise<ControlPlaneSessionUser | Response> {
    const user = await options.currentUser(request);
    return user ?? Response.json({ error: "Authentication required" }, { status: 401 });
  }

  app.get("/v1/client/manifest", async (c) => {
    const user = await requireUser(c.req.raw);
    if (user instanceof Response) return user;
    try {
      return c.json({
        manifest: await clientManifestForUser(options.prisma, {
          userId: user.userId,
          activeOrganizationId: user.activeOrganizationId,
        }),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.get("/v1/admin/control/me", async (c) => {
    const user = await requireUser(c.req.raw);
    if (user instanceof Response) return user;
    try {
      const platformAdmin = await isPlatformAdmin(options.prisma, user.userId);
      return c.json({
        userId: user.userId,
        platformAdmin,
        organizations: await listControlPlaneOrganizations(options.prisma, {
          userId: user.userId,
          platformAdmin,
        }),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.post("/v1/admin/control/organizations", async (c) => {
    const user = await requireUser(c.req.raw);
    if (user instanceof Response) return user;
    try {
      const body = record(await c.req.json());
      const name = text(body.name, "Organization name", 120);
      const slug = text(body.slug, "Organization slug", 100).toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
        throw new ControlPlaneInvalidError("Organization slug is invalid.");
      }
      return c.json(
        await createControlPlaneOrganization(options.prisma, {
          userId: user.userId,
          platformAdmin: await isPlatformAdmin(options.prisma, user.userId),
          name,
          slug,
          ...(body.ownerEmail === undefined ? {} : { ownerEmail: email(body.ownerEmail) }),
        }),
        201,
      );
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.put("/v1/admin/control/organizations/:organizationId/manifest", async (c) => {
    const user = await requireUser(c.req.raw);
    if (user instanceof Response) return user;
    try {
      const content = ClientManifestContentSchema.safeParse(await c.req.json());
      if (!content.success) {
        throw new ControlPlaneInvalidError("Manifest content is invalid.");
      }
      return c.json(
        await publishClientManifest(options.prisma, {
          userId: user.userId,
          platformAdmin: await isPlatformAdmin(options.prisma, user.userId),
          organizationId: c.req.param("organizationId"),
          content: content.data,
          ...(options.signManifest ? { signer: options.signManifest } : {}),
        }),
      );
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.get("/v1/admin/control/organizations/:organizationId/manifest", async (c) => {
    const user = await requireUser(c.req.raw);
    if (user instanceof Response) return user;
    try {
      return c.json({
        manifest: await adminClientManifest(options.prisma, {
          userId: user.userId,
          platformAdmin: await isPlatformAdmin(options.prisma, user.userId),
          organizationId: c.req.param("organizationId"),
        }),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.get("/v1/admin/control/organizations/:organizationId/members", async (c) => {
    const user = await requireUser(c.req.raw);
    if (user instanceof Response) return user;
    try {
      return c.json({
        members: await listOrganizationMembers(options.prisma, {
          userId: user.userId,
          platformAdmin: await isPlatformAdmin(options.prisma, user.userId),
          organizationId: c.req.param("organizationId"),
        }),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.post("/v1/admin/control/organizations/:organizationId/members", async (c) => {
    const user = await requireUser(c.req.raw);
    if (user instanceof Response) return user;
    try {
      const body = record(await c.req.json());
      const role = body.role === undefined ? "member" : body.role;
      if (role !== "member" && role !== "admin") {
        throw new ControlPlaneInvalidError("Member role is invalid.");
      }
      return c.json(
        await addOrganizationMember(options.prisma, {
          userId: user.userId,
          platformAdmin: await isPlatformAdmin(options.prisma, user.userId),
          organizationId: c.req.param("organizationId"),
          email: email(body.email),
          role,
        }),
        201,
      );
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.delete("/v1/admin/control/organizations/:organizationId/members/:targetUserId", async (c) => {
    const user = await requireUser(c.req.raw);
    if (user instanceof Response) return user;
    try {
      await removeOrganizationMember(options.prisma, {
        userId: user.userId,
        platformAdmin: await isPlatformAdmin(options.prisma, user.userId),
        organizationId: c.req.param("organizationId"),
        targetUserId: c.req.param("targetUserId"),
      });
      return c.json({ ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  });
}
