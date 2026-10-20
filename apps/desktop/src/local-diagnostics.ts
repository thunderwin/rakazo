import type { DesktopBrowserBridgeStatus, DesktopUpdateState } from "@rakazo/contracts";

export interface LocalDiagnosticsInput {
  now: Date;
  version: string;
  packaged: boolean;
  platform: NodeJS.Platform;
  arch: string;
  account: {
    serverUrl: string;
    signedIn: boolean;
  } | null;
  runtime: {
    ready: boolean;
    activeRuns: number;
  };
  browser: DesktopBrowserBridgeStatus | null;
  update: DesktopUpdateState;
}

export function createLocalDiagnostics(input: LocalDiagnosticsInput) {
  return {
    collected_at: input.now.toISOString(),
    app: {
      version: input.version,
      packaged: input.packaged,
      platform: input.platform,
      arch: input.arch,
    },
    account: input.account
      ? {
          server: input.account.serverUrl,
          signed_in: input.account.signedIn,
        }
      : null,
    runtime: {
      ready: input.runtime.ready,
      active_runs: input.runtime.activeRuns,
    },
    browser: input.browser,
    update: input.update,
  };
}
