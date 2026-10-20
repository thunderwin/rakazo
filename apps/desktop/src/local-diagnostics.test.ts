import { describe, expect, it } from "vitest";
import { createLocalDiagnostics } from "./local-diagnostics.js";

describe("local diagnostics", () => {
  it("records operational state without account identity or conversation data", () => {
    expect(
      createLocalDiagnostics({
        now: new Date("2026-10-20T12:00:00.000Z"),
        version: "0.3.1",
        packaged: true,
        platform: "darwin",
        arch: "arm64",
        account: {
          serverUrl: "https://api.example.com",
          signedIn: true,
        },
        runtime: {
          ready: true,
          activeRuns: 1,
        },
        browser: {
          available: true,
          connected: false,
          port: 47891,
          error: null,
          clientVersion: null,
        },
        update: {
          phase: "idle",
          currentVersion: "0.3.1",
          availableVersion: null,
          percent: null,
          message: null,
          checkedAt: null,
        },
      }),
    ).toEqual({
      collected_at: "2026-10-20T12:00:00.000Z",
      app: {
        version: "0.3.1",
        packaged: true,
        platform: "darwin",
        arch: "arm64",
      },
      account: {
        server: "https://api.example.com",
        signed_in: true,
      },
      runtime: {
        ready: true,
        active_runs: 1,
      },
      browser: {
        available: true,
        connected: false,
        port: 47891,
        error: null,
        clientVersion: null,
      },
      update: {
        phase: "idle",
        currentVersion: "0.3.1",
        availableVersion: null,
        percent: null,
        message: null,
        checkedAt: null,
      },
    });
  });
});
