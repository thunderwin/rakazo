import * as z from "zod";

const ClientKey = z.string().trim().min(1).max(120);

export const ClientBotPresetSchema = z.object({
  key: ClientKey,
  name: z.string().trim().min(1).max(120),
  title: z.string().max(200).default(""),
  description: z.string().max(2_000).default(""),
  instructions: z.string().max(40_000).default(""),
  color: z.string().max(40).default("blue"),
  modelId: z.string().max(300).nullable().default(null),
  thinkingLevel: z.string().max(40).nullable().default(null),
  disabledBuiltinTools: z.array(z.string().max(100)).max(200).default([]),
});

export const ClientGroupPresetSchema = z.object({
  key: ClientKey,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2_000).default(""),
  color: z.string().max(40).default("violet"),
  botKeys: z.array(ClientKey).min(2).max(10),
});

export const ClientKnowledgePresetSchema = z.object({
  key: ClientKey,
  title: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(500_000),
});

export const ClientSkillPresetSchema = z.object({
  key: ClientKey,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(2_000),
  content: z.string().min(1).max(100_000),
});

export const ClientRoutinePresetSchema = z.object({
  key: ClientKey,
  botKey: ClientKey,
  name: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(100_000),
  cron: z.string().trim().min(1).max(200),
  timezone: z.string().trim().min(1).max(100).default("UTC"),
  enabled: z.boolean().default(true),
});

export const ClientManifestContentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  minimumClientVersion: z.string().trim().max(40).default("0.0.0"),
  botTemplates: z.array(ClientBotPresetSchema).max(100).default([]),
  groupPresets: z.array(ClientGroupPresetSchema).max(100).default([]),
  knowledge: z.array(ClientKnowledgePresetSchema).max(500).default([]),
  skills: z.array(ClientSkillPresetSchema).max(200).default([]),
  routines: z.array(ClientRoutinePresetSchema).max(500).default([]),
  featurePolicy: z
    .object({
      disabledTools: z.array(z.string().max(100)).max(500).default([]),
      allowComputerUse: z.boolean().default(false),
    })
    .default({ disabledTools: [], allowComputerUse: false }),
});

export type ClientManifestContent = z.infer<typeof ClientManifestContentSchema>;

export const ClientManifestEnvelopeSchema = z.object({
  organization: z.object({
    id: z.string(),
    name: z.string(),
  }),
  version: z.number().int().positive(),
  hash: z.string(),
  publishedAt: z.string(),
  signature: z.string().nullable(),
  content: ClientManifestContentSchema,
});

export type ClientManifestEnvelope = z.infer<typeof ClientManifestEnvelopeSchema>;

export const ControlPlaneOrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  role: z.string(),
  memberCount: z.number().int().nonnegative(),
  manifestVersion: z.number().int().nonnegative(),
  manifestPublishedAt: z.string().nullable(),
});

export type ControlPlaneOrganization = z.infer<typeof ControlPlaneOrganizationSchema>;

export const ControlPlaneMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  createdAt: z.string(),
});

export type ControlPlaneMember = z.infer<typeof ControlPlaneMemberSchema>;
