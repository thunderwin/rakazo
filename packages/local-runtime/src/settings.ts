import type { JsonValue } from "@rakazo/local-db";

export interface LocalUserSettings {
  theme: "system" | "light" | "dark";
  sendWithEnter: boolean;
  defaultModelId: string | null;
}

export const DEFAULT_LOCAL_USER_SETTINGS: LocalUserSettings = {
  theme: "light",
  sendWithEnter: true,
  defaultModelId: null,
};

export function parseLocalUserSettings(
  value: JsonValue | null,
): LocalUserSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_LOCAL_USER_SETTINGS };
  }
  return {
    theme:
      value.theme === "light" ||
      value.theme === "dark" ||
      value.theme === "system"
        ? value.theme
        : DEFAULT_LOCAL_USER_SETTINGS.theme,
    sendWithEnter:
      typeof value.sendWithEnter === "boolean"
        ? value.sendWithEnter
        : DEFAULT_LOCAL_USER_SETTINGS.sendWithEnter,
    defaultModelId:
      typeof value.defaultModelId === "string" && value.defaultModelId.trim()
        ? value.defaultModelId.trim()
        : null,
  };
}
