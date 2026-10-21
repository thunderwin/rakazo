import type {
  DesktopGroupMessage,
  DesktopLocalBot,
  DesktopLocalGroup,
  DesktopLocalMessage,
  DesktopLocalRunEvent,
  DesktopLocalUserSettings,
  RakazoDesktopLocal,
} from "@rakazo/contracts";

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

export function messageBlocks(message: { blocks: unknown[] }): LocalMessageBlock[] {
  return message.blocks.filter(
    (block): block is LocalMessageBlock =>
      typeof block === "object" && block !== null && !Array.isArray(block) && "kind" in block,
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
  return error instanceof Error && error.message.trim()
    ? error.message
    : "The request could not be completed.";
}
