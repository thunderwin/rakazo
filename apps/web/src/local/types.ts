import type {
  DesktopLocalBot,
  DesktopLocalMessage,
  DesktopLocalRunEvent,
  DesktopLocalUserSettings,
  RakazoDesktopLocal,
} from "@rakazo/contracts";

export type LocalBridge = RakazoDesktopLocal;
export type LocalBot = DesktopLocalBot;
export type LocalMessage = DesktopLocalMessage;
export type LocalSettings = DesktopLocalUserSettings;
export type LocalRunEvent = DesktopLocalRunEvent;

export type LocalMessageBlock =
  | { kind: "text"; text: string }
  | { kind: "error"; message: string }
  | {
      kind: "tool_call";
      executionId?: string;
      name: string;
      arguments?: Record<string, unknown>;
    }
  | { kind: string; [key: string]: unknown };

export function messageBlocks(message: LocalMessage): LocalMessageBlock[] {
  return message.blocks.filter(
    (block): block is LocalMessageBlock =>
      typeof block === "object" && block !== null && !Array.isArray(block) && "kind" in block,
  );
}

export function messageText(message: LocalMessage): string {
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
