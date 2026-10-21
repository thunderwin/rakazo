import { msg } from "@lingui/core/macro";
import type {
  DesktopGroupMessage,
  DesktopLocalBot,
  DesktopLocalGroup,
  DesktopLocalMessage,
  DesktopLocalRunEvent,
  DesktopLocalUserSettings,
  RakazoDesktopLocal,
} from "@rakazo/contracts";
import { i18n } from "../lib/i18n";

export type LocalBridge = RakazoDesktopLocal;
export type LocalBot = DesktopLocalBot;
export type LocalGroup = DesktopLocalGroup;
export type LocalMessage = DesktopLocalMessage;
export type LocalGroupMessage = DesktopGroupMessage;
export type LocalSettings = DesktopLocalUserSettings;
export type LocalRunEvent = DesktopLocalRunEvent;

export type LocalMessageBlock =
  | { kind: "text"; text: string }
  | { kind: "error"; message: string }
  | { kind: "image"; artifactId: string; mimeType: string; name: string }
  | {
      kind: "file";
      artifactId: string;
      mimeType: string;
      name: string;
      size: number;
    }
  | {
      kind: "tool_call";
      executionId?: string;
      name: string;
      arguments?: Record<string, unknown>;
    }
  | {
      kind: "handoff";
      fromBotId: string;
      toBotId: string;
      text: string;
      hop: number;
    }
  | { kind: string; [key: string]: unknown };

export function messageBlocks(message: {
  blocks: unknown[];
}): LocalMessageBlock[] {
  return message.blocks.filter(
    (block): block is LocalMessageBlock =>
      typeof block === "object" &&
      block !== null &&
      !Array.isArray(block) &&
      "kind" in block,
  );
}

export function messageText(message: { blocks: unknown[] }): string {
  return messageBlocks(message)
    .filter(
      (block): block is { kind: "text"; text: string } =>
        block.kind === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

export function localErrorMessage(error: unknown): string {
  return error instanceof Error
    ? localErrorText(error.message)
    : localErrorText("");
}

export function localErrorText(message: string): string {
  const text = message.trim();
  const normalized = text.toLocaleLowerCase();
  if (
    normalized.includes("model gateway is not configured") ||
    normalized.includes("local model gateway is not configured") ||
    normalized.includes("new api is not configured")
  ) {
    return i18n._(
      msg`The model gateway is not configured. Ask an administrator to connect a model service.`,
    );
  }
  if (
    normalized.includes("selected model is unavailable") ||
    normalized.includes("invalid model request") ||
    normalized.includes("invalid model") ||
    normalized.includes("model not found") ||
    normalized.includes("model id is invalid") ||
    /\b400\b/.test(normalized) ||
    /\b404\b/.test(normalized)
  ) {
    return i18n._(
      msg`The selected model is unavailable or invalid. Choose another model.`,
    );
  }
  if (
    normalized.includes("model gateway denied") ||
    normalized.includes("access denied") ||
    normalized.includes("forbidden") ||
    /\b403\b/.test(normalized)
  ) {
    return i18n._(msg`The model gateway denied this request.`);
  }
  if (
    normalized.includes("model request is too large") ||
    normalized.includes("request too large") ||
    /\b413\b/.test(normalized)
  ) {
    return i18n._(
      msg`The model request is too large. Remove attachments or shorten the message.`,
    );
  }
  if (
    normalized.includes("insufficient_quota") ||
    normalized.includes("insufficient quota") ||
    normalized.includes("quota exhausted") ||
    normalized.includes("quota is exhausted") ||
    /\b402\b/.test(normalized)
  ) {
    return i18n._(msg`Model quota exhausted. Check your plan or balance.`);
  }
  if (
    normalized.includes("session is no longer valid") ||
    normalized.includes("unauthorized") ||
    normalized.includes("session expired") ||
    normalized.includes("invalid token") ||
    /\b401\b/.test(normalized)
  ) {
    return i18n._(msg`Your session has expired. Sign out and sign in again.`);
  }
  if (
    normalized.includes("model service is busy") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    /\b429\b/.test(normalized)
  ) {
    return i18n._(msg`The model service is busy. Try again shortly.`);
  }
  if (
    normalized.includes("could not reach the model service") ||
    normalized.includes("fetch failed") ||
    normalized.includes("econnrefused") ||
    normalized.includes("enotfound") ||
    normalized.includes("network error")
  ) {
    return i18n._(
      msg`Could not reach the model service. Check your connection and try again.`,
    );
  }
  if (
    normalized.includes("model request timed out") ||
    normalized.includes("timed out") ||
    normalized.includes("timeout")
  ) {
    return i18n._(msg`The model request timed out. Try again.`);
  }
  if (
    normalized.includes("model request failed") ||
    normalized.includes("model gateway unavailable")
  ) {
    return i18n._(msg`The model request failed. Try again.`);
  }
  return text || i18n._(msg`The request could not be completed.`);
}
