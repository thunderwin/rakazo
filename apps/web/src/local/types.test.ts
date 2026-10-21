import { i18n } from "@lingui/core";
import { beforeEach, describe, expect, it } from "vitest";
import { localErrorMessage, localErrorText } from "./types";

describe("local error text", () => {
  beforeEach(() => {
    i18n.load("en", {});
    i18n.activate("en");
  });

  it("turns the remote IPC wrapper into an actionable gateway message", () => {
    expect(
      localErrorMessage(
        new Error(
          "Error invoking remote method 'desktop.local.messages.send': Error: The model gateway is not configured.",
        ),
      ),
    ).toBe(
      "The model gateway is not configured. Ask an administrator to connect a model service.",
    );
  });

  it("distinguishes invalid models and oversized requests", () => {
    expect(localErrorText("HTTP 400 invalid model request")).toBe(
      "The selected model is unavailable or invalid. Choose another model.",
    );
    expect(localErrorText("HTTP 413 request too large")).toBe(
      "The model request is too large. Remove attachments or shorten the message.",
    );
  });

  it("recognizes the Pi quota wording", () => {
    expect(
      localErrorText(
        "Error invoking remote method 'desktop.local.messages.send': Error: Your model quota is exhausted. Check your plan or balance.",
      ),
    ).toBe("Model quota exhausted. Check your plan or balance.");
  });
});
