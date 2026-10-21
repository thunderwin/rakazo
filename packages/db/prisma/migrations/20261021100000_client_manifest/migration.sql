CREATE TABLE "client_manifests" (
  "organizationId" TEXT NOT NULL,
  "content" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "version" INTEGER NOT NULL DEFAULT 0,
  "hash" TEXT,
  "signature" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "client_manifests_pkey" PRIMARY KEY ("organizationId")
);

CREATE TABLE "control_plane_audits" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "control_plane_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "control_plane_audits_organizationId_createdAt_idx"
  ON "control_plane_audits"("organizationId", "createdAt");
CREATE INDEX "control_plane_audits_actorUserId_createdAt_idx"
  ON "control_plane_audits"("actorUserId", "createdAt");

ALTER TABLE "client_manifests"
  ADD CONSTRAINT "client_manifests_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
