import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ClientManifestEnvelope } from "@rakazo/contracts";
import { ClientManifestContentSchema } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import type { Hono } from "hono";
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

const ADMIN_DIST_ROOT = path.resolve(import.meta.dirname, "../../admin/dist");

function adminContentType(file: string): string {
  const extension = path.extname(file);
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  if (extension === ".woff2") return "font/woff2";
  return "application/octet-stream";
}

async function adminAsset(requestPath: string): Promise<string | null> {
  const relative =
    requestPath === "/admin" || requestPath === "/admin/"
      ? "index.html"
      : requestPath.replace(/^\/admin\/?/, "");
  const decoded = decodeURIComponent(relative);
  const file = path.resolve(ADMIN_DIST_ROOT, decoded);
  if (file !== ADMIN_DIST_ROOT && !file.startsWith(`${ADMIN_DIST_ROOT}${path.sep}`)) {
    return null;
  }
  return file;
}

export interface ControlPlaneSessionUser {
  userId: string;
  email?: string | null;
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
    return readFile(path.join(ADMIN_DIST_ROOT, "index.html"))
      .then((body) => c.html(body.toString("utf8")))
      .catch(() =>
        c.html(
          "<!doctype html><meta charset=utf-8><title>Admin not built</title><p>请先运行 <code>pnpm --filter @rakazo/admin build</code>。</p>",
          503,
        ),
      );
  });
  app.get("/admin/*", async (c) => {
    const file = await adminAsset(c.req.path);
    if (!file) return c.notFound();
    try {
      const body = await readFile(file);
      return new Response(new Uint8Array(body), {
        headers: {
          "cache-control": file.endsWith("index.html")
            ? "no-store"
            : "public, max-age=31536000, immutable",
          "content-type": adminContentType(file),
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      return c.notFound();
    }
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
      const platformAdmin = await isPlatformAdmin(options.prisma, user.userId, user.email);
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
          platformAdmin: await isPlatformAdmin(options.prisma, user.userId, user.email),
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
          platformAdmin: await isPlatformAdmin(options.prisma, user.userId, user.email),
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
          platformAdmin: await isPlatformAdmin(options.prisma, user.userId, user.email),
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
          platformAdmin: await isPlatformAdmin(options.prisma, user.userId, user.email),
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
          platformAdmin: await isPlatformAdmin(options.prisma, user.userId, user.email),
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
        platformAdmin: await isPlatformAdmin(options.prisma, user.userId, user.email),
        organizationId: c.req.param("organizationId"),
        targetUserId: c.req.param("targetUserId"),
      });
      return c.json({ ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  });
}
