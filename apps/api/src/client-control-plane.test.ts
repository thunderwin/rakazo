import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  clientManifestForUser,
  hasAdminRole,
  isPlatformAdmin,
  publishClientManifest,
} from "./client-control-plane.js";
import { mountClientControlPlane } from "./client-control-plane-http.js";

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

describe("client control plane", () => {
  it("recognizes comma-separated owner and admin roles", () => {
    expect(hasAdminRole("member, admin")).toBe(true);
    expect(hasAdminRole("owner")).toBe(true);
    expect(hasAdminRole("member")).toBe(false);
  });

  it("allows configured development platform-admin emails without replacing the owner", async () => {
    const prisma = {
      deploymentSettings: {
        findUnique: vi.fn(async () => ({ ownerUserId: "owner-1" })),
      },
    };
    await expect(isPlatformAdmin(prisma as never, "owner-1")).resolves.toBe(true);
    await expect(
      isPlatformAdmin(prisma as never, "test-1", "platform-admin@ericbot.test", {
        PLATFORM_ADMIN_EMAILS: "other@example.test, PLATFORM-ADMIN@ERICBOT.TEST",
      }),
    ).resolves.toBe(true);
    await expect(
      isPlatformAdmin(prisma as never, "test-2", "member@ericbot.test", {
        PLATFORM_ADMIN_EMAILS: "platform-admin@ericbot.test",
      }),
    ).resolves.toBe(false);
  });

  it("returns the one published organization manifest for a user", async () => {
    const prisma = {
      member: {
        findMany: vi.fn(async () => [
          {
            organizationId: "org-1",
            organization: {
              id: "org-1",
              name: "Example Company",
              clientManifest: {
                version: 3,
                hash: "abc",
                publishedAt: new Date("2026-10-21T00:00:00.000Z"),
                content,
              },
            },
          },
        ]),
      },
    };

    await expect(
      clientManifestForUser(prisma as never, { userId: "user-1" }),
    ).resolves.toMatchObject({
      organization: { id: "org-1", name: "Example Company" },
      version: 3,
      signature: null,
    });
  });

  it("publishes a validated versioned manifest and audits the actor", async () => {
    const upsert = vi.fn(async ({ create }: { create: Record<string, unknown> }) => ({
      ...create,
      version: 1,
      publishedAt: new Date("2026-10-21T00:00:00.000Z"),
    }));
    const audit = vi.fn(async () => ({}));
    const prisma = {
      organization: {
        findUnique: vi.fn(async () => ({ id: "org-1", name: "Example Company" })),
      },
      clientManifest: { upsert },
      controlPlaneAudit: { create: audit },
    };

    await expect(
      publishClientManifest(prisma as never, {
        userId: "admin-1",
        platformAdmin: true,
        organizationId: "org-1",
        content,
      }),
    ).resolves.toMatchObject({ version: 1, content: { name: "Example Company" } });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ version: { increment: 1 } }),
      }),
    );
    expect(audit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "manifest.published",
        actorUserId: "admin-1",
      }),
    });
  });

  it("requires authentication on control-plane routes", async () => {
    const app = mountForTest(null);
    const response = await app.request("https://api.example.com/v1/client/manifest");
    expect(response.status).toBe(401);
  });
});

function mountForTest(user: { userId: string; activeOrganizationId: string | null } | null) {
  const app = new Hono();
  mountClientControlPlane(app, {
    prisma: {
      member: { findMany: vi.fn(async () => []) },
    } as never,
    currentUser: async () => user,
  });
  return app;
}
