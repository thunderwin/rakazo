import { createHash, randomUUID } from "node:crypto";
import type {
  ClientManifestContent,
  ClientManifestEnvelope,
  ControlPlaneMember,
  ControlPlaneOrganization,
} from "@rakazo/contracts";
import { ClientManifestContentSchema } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";

const ADMIN_ROLES = new Set(["owner", "admin"]);

export class ControlPlaneForbiddenError extends Error {}
export class ControlPlaneConflictError extends Error {}
export class ControlPlaneNotFoundError extends Error {}
export class ControlPlaneInvalidError extends Error {}

function roles(value: string): Set<string> {
  return new Set(
    value
      .split(",")
      .map((role) => role.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function hasAdminRole(value: string): boolean {
  const parsed = roles(value);
  return [...ADMIN_ROLES].some((role) => parsed.has(role));
}

function manifestHash(content: ClientManifestContent): string {
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

function manifestEnvelope(input: {
  organization: { id: string; name: string };
  version: number;
  publishedAt: Date | null;
  hash: string | null;
  signature: string | null;
  content: unknown;
}): ClientManifestEnvelope | null {
  if (!input.publishedAt || !input.hash) return null;
  const content = ClientManifestContentSchema.parse(input.content);
  return {
    organization: input.organization,
    version: input.version,
    hash: input.hash,
    publishedAt: input.publishedAt.toISOString(),
    signature: input.signature ?? null,
    content,
  };
}

export async function clientManifestForUser(
  prisma: PrismaClient,
  input: { userId: string; activeOrganizationId?: string | null },
): Promise<ClientManifestEnvelope | null> {
  const memberships = await prisma.member.findMany({
    where: { userId: input.userId },
    select: {
      organizationId: true,
      organization: {
        select: {
          id: true,
          name: true,
          clientManifest: true,
        },
      },
    },
  });
  const active = input.activeOrganizationId
    ? memberships.find(
        (membership) =>
          membership.organizationId === input.activeOrganizationId &&
          membership.organization.clientManifest?.publishedAt,
      )
    : undefined;
  const candidates = memberships.filter(
    (membership) => membership.organization.clientManifest?.publishedAt,
  );
  const selected = active ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (!selected) {
    if (candidates.length > 1) {
      throw new ControlPlaneConflictError(
        "Multiple organizations are assigned; select one before requesting a client manifest.",
      );
    }
    return null;
  }
  const manifest = selected.organization.clientManifest!;
  return manifestEnvelope({
    organization: selected.organization,
    version: manifest.version,
    publishedAt: manifest.publishedAt,
    hash: manifest.hash,
    signature: manifest.signature,
    content: manifest.content,
  });
}

export async function isPlatformAdmin(prisma: PrismaClient, userId: string): Promise<boolean> {
  const settings = await prisma.deploymentSettings.findUnique({
    where: { id: "default" },
    select: { ownerUserId: true },
  });
  return settings?.ownerUserId === userId;
}

async function membershipRole(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<string | null> {
  const membership = await prisma.member.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { role: true },
  });
  return membership?.role ?? null;
}

async function assertAdmin(input: {
  prisma: PrismaClient;
  userId: string;
  organizationId: string;
  platformAdmin: boolean;
}): Promise<string> {
  if (input.platformAdmin) return "platform_admin";
  const role = await membershipRole(input.prisma, input.userId, input.organizationId);
  if (!role || !hasAdminRole(role)) {
    throw new ControlPlaneForbiddenError("Organization administrator access is required.");
  }
  return role;
}

async function audit(
  prisma: PrismaClient,
  input: {
    organizationId?: string;
    actorUserId: string;
    action: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await prisma.controlPlaneAudit.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: input.action,
      metadata: (input.metadata ?? {}) as never,
    },
  });
}

export async function listControlPlaneOrganizations(
  prisma: PrismaClient,
  input: { userId: string; platformAdmin: boolean },
): Promise<ControlPlaneOrganization[]> {
  const rows = await prisma.organization.findMany({
    where: input.platformAdmin
      ? {}
      : {
          members: {
            some: {
              userId: input.userId,
            },
          },
        },
    select: {
      id: true,
      name: true,
      slug: true,
      clientManifest: {
        select: { version: true, publishedAt: true },
      },
      _count: { select: { members: true } },
      members: {
        where: { userId: input.userId },
        select: { role: true },
      },
    },
    orderBy: { name: "asc" },
  });
  return rows
    .filter((row) => input.platformAdmin || row.members.some((member) => hasAdminRole(member.role)))
    .map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      role: input.platformAdmin ? "platform_admin" : (row.members[0]?.role ?? "member"),
      memberCount: row._count.members,
      manifestVersion: row.clientManifest?.version ?? 0,
      manifestPublishedAt: row.clientManifest?.publishedAt?.toISOString() ?? null,
    }));
}

export async function publishClientManifest(
  prisma: PrismaClient,
  input: {
    userId: string;
    platformAdmin: boolean;
    organizationId: string;
    content: unknown;
    signer?: (manifest: ClientManifestEnvelope) => string;
  },
): Promise<ClientManifestEnvelope> {
  await assertAdmin({ ...input, prisma });
  const content = ClientManifestContentSchema.parse(input.content);
  const organization = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, name: true },
  });
  if (!organization) throw new ControlPlaneNotFoundError("Organization not found.");
  const hash = manifestHash(content);
  const row = await prisma.clientManifest.upsert({
    where: { organizationId: organization.id },
    create: {
      organizationId: organization.id,
      content: content as never,
      version: 1,
      hash,
      signature: null,
      publishedAt: new Date(),
      createdByUserId: input.userId,
    },
    update: {
      content: content as never,
      version: { increment: 1 },
      hash,
      signature: null,
      publishedAt: new Date(),
      createdByUserId: input.userId,
    },
  });
  await audit(prisma, {
    organizationId: organization.id,
    actorUserId: input.userId,
    action: "manifest.published",
    metadata: { version: row.version, hash },
  });
  const unsigned = manifestEnvelope({
    organization,
    version: row.version,
    publishedAt: row.publishedAt,
    hash: row.hash,
    signature: null,
    content: row.content,
  })!;
  if (!input.signer) return unsigned;
  const signature = input.signer(unsigned);
  await prisma.clientManifest.update({
    where: { organizationId: organization.id },
    data: { signature },
  });
  return { ...unsigned, signature };
}

export async function adminClientManifest(
  prisma: PrismaClient,
  input: {
    userId: string;
    platformAdmin: boolean;
    organizationId: string;
  },
): Promise<ClientManifestEnvelope | null> {
  await assertAdmin({ ...input, prisma });
  const organization = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: {
      id: true,
      name: true,
      clientManifest: true,
    },
  });
  if (!organization) throw new ControlPlaneNotFoundError("Organization not found.");
  const manifest = organization.clientManifest;
  return manifest
    ? manifestEnvelope({
        organization,
        version: manifest.version,
        publishedAt: manifest.publishedAt,
        hash: manifest.hash,
        signature: manifest.signature,
        content: manifest.content,
      })
    : null;
}

export async function listOrganizationMembers(
  prisma: PrismaClient,
  input: {
    userId: string;
    platformAdmin: boolean;
    organizationId: string;
  },
): Promise<ControlPlaneMember[]> {
  await assertAdmin({ ...input, prisma });
  const rows = await prisma.member.findMany({
    where: { organizationId: input.organizationId },
    select: {
      userId: true,
      role: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({
    userId: row.userId,
    name: row.user.name,
    email: row.user.email,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function addOrganizationMember(
  prisma: PrismaClient,
  input: {
    userId: string;
    platformAdmin: boolean;
    organizationId: string;
    email: string;
    role: "member" | "admin";
  },
): Promise<ControlPlaneMember> {
  const actorRole = await assertAdmin({ ...input, prisma });
  if (input.role === "admin" && !input.platformAdmin && !roles(actorRole).has("owner")) {
    throw new ControlPlaneForbiddenError("Only an organization owner can add administrators.");
  }
  const target = await prisma.user.findUnique({
    where: { email: input.email.trim().toLowerCase() },
    select: { id: true, name: true, email: true },
  });
  if (!target) throw new ControlPlaneNotFoundError("User not found.");
  const defaultSpace = await prisma.space.findFirst({
    where: { organizationId: input.organizationId, isDefault: true },
    select: { id: true },
  });
  if (!defaultSpace) throw new ControlPlaneNotFoundError("Organization default space not found.");
  await prisma.$transaction([
    prisma.member.upsert({
      where: {
        organizationId_userId: {
          organizationId: input.organizationId,
          userId: target.id,
        },
      },
      create: {
        id: randomUUID(),
        organizationId: input.organizationId,
        userId: target.id,
        role: input.role,
        createdAt: new Date(),
      },
      update: { role: input.role },
    }),
    prisma.spaceMember.upsert({
      where: {
        spaceId_userId: {
          spaceId: defaultSpace.id,
          userId: target.id,
        },
      },
      create: {
        id: randomUUID(),
        spaceId: defaultSpace.id,
        organizationId: input.organizationId,
        userId: target.id,
        role: input.role,
        createdAt: new Date(),
      },
      update: { role: input.role },
    }),
  ]);
  await audit(prisma, {
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "member.added",
    metadata: { targetUserId: target.id, role: input.role },
  });
  return {
    userId: target.id,
    name: target.name,
    email: target.email,
    role: input.role,
    createdAt: new Date().toISOString(),
  };
}

export async function removeOrganizationMember(
  prisma: PrismaClient,
  input: {
    userId: string;
    platformAdmin: boolean;
    organizationId: string;
    targetUserId: string;
  },
): Promise<void> {
  await assertAdmin({ ...input, prisma });
  const target = await prisma.member.findUnique({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.targetUserId,
      },
    },
    select: { role: true },
  });
  if (!target) throw new ControlPlaneNotFoundError("Organization member not found.");
  if (!input.platformAdmin && roles(target.role).has("owner")) {
    throw new ControlPlaneForbiddenError("Organization owners cannot be removed here.");
  }
  await prisma.member.delete({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.targetUserId,
      },
    },
  });
  await audit(prisma, {
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "member.removed",
    metadata: { targetUserId: input.targetUserId },
  });
}

export async function createControlPlaneOrganization(
  prisma: PrismaClient,
  input: {
    userId: string;
    platformAdmin: boolean;
    name: string;
    slug: string;
    ownerEmail?: string;
  },
): Promise<ControlPlaneOrganization> {
  if (!input.platformAdmin) {
    throw new ControlPlaneForbiddenError("Platform administrator access is required.");
  }
  const owner = input.ownerEmail
    ? await prisma.user.findUnique({
        where: { email: input.ownerEmail.trim().toLowerCase() },
        select: { id: true },
      })
    : { id: input.userId };
  if (!owner) throw new ControlPlaneNotFoundError("Owner user not found.");
  const organizationId = randomUUID();
  const spaceId = randomUUID();
  const now = new Date();
  await prisma.$transaction([
    prisma.organization.create({
      data: {
        id: organizationId,
        name: input.name.trim(),
        slug: input.slug.trim(),
        createdAt: now,
      },
    }),
    prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId,
        userId: owner.id,
        role: "owner",
        createdAt: now,
      },
    }),
    prisma.space.create({
      data: {
        id: spaceId,
        organizationId,
        name: "General",
        isDefault: true,
        createdByUserId: owner.id,
        createdAt: now,
      },
    }),
    prisma.spaceMember.create({
      data: {
        id: randomUUID(),
        spaceId,
        organizationId,
        userId: owner.id,
        role: "owner",
        createdAt: now,
      },
    }),
  ]);
  await audit(prisma, {
    organizationId,
    actorUserId: input.userId,
    action: "organization.created",
    metadata: { ownerUserId: owner.id },
  });
  return {
    id: organizationId,
    name: input.name.trim(),
    slug: input.slug.trim(),
    role: "platform_admin",
    memberCount: 1,
    manifestVersion: 0,
    manifestPublishedAt: null,
  };
}
