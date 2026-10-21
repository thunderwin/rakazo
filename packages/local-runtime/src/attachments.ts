import path from "node:path";
import {
  decodeAttachmentBase64,
  messageBlockForArtifact,
  promptTextForAttachments,
  validateAttachmentMimeType,
} from "@rakazo/core";
import type { ArtifactRepository, LocalArtifact, LocalArtifactWithContent } from "@rakazo/local-db";

const MAX_ATTACHMENTS = 4;
const MAX_ARTIFACT_NAME_CHARS = 255;

export interface LocalAttachment extends LocalArtifact {
  data: Uint8Array;
}

export interface LocalArtifactInput {
  botId?: string;
  groupId?: string;
  name: string;
  mimeType: string;
  contentBase64: string;
}

export class LocalAttachmentStore {
  constructor(private readonly artifacts: ArtifactRepository) {}

  create(input: LocalArtifactInput): LocalArtifact {
    const name = path
      .basename(input.name.trim().replaceAll("\\", "/"))
      .slice(0, MAX_ARTIFACT_NAME_CHARS);
    if (!name) throw new Error("Attachment name is required");
    validateAttachmentMimeType(input.mimeType);
    const content = decodeAttachmentBase64(input.contentBase64);
    return this.artifacts.create({
      ...(input.botId ? { botId: input.botId } : {}),
      ...(input.groupId ? { groupId: input.groupId } : {}),
      name,
      mimeType: input.mimeType,
      content,
    });
  }

  read(id: string): (LocalArtifactWithContent & { contentBase64: string }) | null {
    const artifact = this.artifacts.read(id);
    return artifact
      ? {
          ...artifact,
          contentBase64: Buffer.from(artifact.content).toString("base64"),
        }
      : null;
  }

  resolveForBot(botId: string, ids: string[]): LocalAttachment[] {
    return this.resolve(ids, (artifact) => artifact.botId === botId);
  }

  resolveForGroup(groupId: string, ids: string[]): LocalAttachment[] {
    return this.resolve(ids, (artifact) => artifact.groupId === groupId);
  }

  promptText(text: string, attachments: readonly LocalAttachment[]): string {
    return promptTextForAttachments(text, [...attachments]);
  }

  messageBlocks(text: string, attachments: readonly LocalAttachment[]) {
    return [
      ...(text.trim() ? [{ kind: "text" as const, text: text.trim() }] : []),
      ...attachments.map((attachment) => messageBlockForArtifact(attachment)),
    ];
  }

  imageParts(attachments: readonly LocalAttachment[]) {
    return attachments
      .filter(
        (attachment) =>
          attachment.mimeType === "image/jpeg" ||
          attachment.mimeType === "image/png" ||
          attachment.mimeType === "image/webp" ||
          attachment.mimeType === "image/gif",
      )
      .map((attachment) => ({
        name: attachment.name,
        mimeType: attachment.mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
        data: attachment.data,
      }));
  }

  private resolve(
    ids: string[],
    belongsToTarget: (artifact: LocalArtifact) => boolean,
  ): LocalAttachment[] {
    const unique = [...new Set(ids)];
    if (unique.length > MAX_ATTACHMENTS) {
      throw new Error(`Attach at most ${MAX_ATTACHMENTS} files`);
    }
    return unique.map((id) => {
      const artifact = this.artifacts.read(id);
      if (!artifact || !belongsToTarget(artifact)) {
        throw new Error("Attachment not found");
      }
      const { content, ...metadata } = artifact;
      return { ...metadata, data: content };
    });
  }
}
