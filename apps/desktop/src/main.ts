import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ATTACHMENT_MAX_BASE64_LENGTH,
  type DesktopLocalChoiceRequest,
  type DesktopLocalSecretAuth,
  type DesktopLocalSecretRequest,
  type DesktopReachability,
  type DesktopSetup,
} from "@rakazo/contracts";
import { LOCAL_SETTINGS_PAGE } from "@rakazo/contracts/local-settings";
import type {
  LocalRuntimeService,
  LocalSkillScriptInput,
} from "@rakazo/local-runtime";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  net,
  type Session,
  session,
  shell,
} from "electron";
import type { AppDocumentState } from "./app-document-state.js";
import { APP_DOCUMENT_STATE_SCRIPT } from "./app-document-state.js";
import { createAppOpener } from "./app-opener.js";
import {
  DesktopUpdateController,
  type ElectronAutoUpdater,
  LAUNCH_CHECK_DELAY_MS,
} from "./auto-update.js";
import { openBrowserAuth } from "./browser-auth.js";
import { DesktopBrowserBridge } from "./browser-bridge.js";
import {
  fetchClientManifest,
  verifyClientManifest,
} from "./client-manifest-sync.js";
import {
  DOCKER_INSTALL_LINKS,
  isDesktopSetupLink,
  runDocker,
} from "./docker-cli.js";
import { prepareHostComputer } from "./host-computer.js";
import { localAccountKey } from "./local-account-data.js";
import { LocalAuth } from "./local-auth.js";
import { createSafeStorageVault } from "./local-auth-vault.js";
import { launchLocalApplication } from "./local-desktop-actions.js";
import { createLocalDiagnostics } from "./local-diagnostics.js";
import {
  createDesktopLocalRuntime,
  defaultLocalModel,
} from "./local-runtime.js";
import { createSafeStorageSecretVault } from "./local-secret-vault.js";
import { requestLocalSettings } from "./local-settings.js";
import {
  LocalStackController,
  readStackToken,
  readStackWebUrl,
  resolveImageTag,
  stackDir,
  stackResourceDir,
} from "./local-stack.js";
import { oauthCallbackFrom } from "./oauth-callback.js";
import {
  bundledRendererCandidates,
  contentType,
  forwardedRendererRequestInit,
  immutableRendererAsset,
  isRendererAssetMiss,
} from "./renderer-assets.js";
import { installSessionPermissions } from "./session-permissions.js";
import {
  DEFAULT_LOCAL_WEB_URL,
  desktopStackImageTag,
  isRakazoHealth,
  managedLocalOpenUrl,
  maySendDesktopStackToken,
  normalizeServerUrl,
  parseSetupInput,
  probeFailureMessage,
  readProbeJson,
  resolveStartupTarget,
  safeExternalUrl,
  servesBundledRenderer,
  sessionPartitionForServerUrl,
  usesLocalUiOnStartup,
} from "./setup-config.js";
import { clearSetup, readSetup, writeSetup } from "./setup-store.js";
import {
  oauthPopupSessionPreferences,
  shouldOpenInAppPopup,
} from "./window-open.js";
import {
  browserWindowOptions,
  developmentIconFile,
  setupWindowOptions,
  warmWindowTtlMs,
} from "./window-options.js";

const PERFORMANCE_USER_DATA = process.env.RAKAZO_PERFORMANCE_USER_DATA;
/** Test hook: where the app-managed stack answers. Mode `new` still requires loopback. */
const LOCAL_WEB_URL =
  process.env.RAKAZO_LOCAL_WEB_URL?.trim() || DEFAULT_LOCAL_WEB_URL;
const PROBE_TIMEOUT_MS = 8_000;
const APP_DOCUMENT_READY_TIMEOUT_MS = 20_000;
const DESKTOP_STACK_PROBE_PATH = "/.well-known/rakazo-desktop-stack";
const DESKTOP_STACK_TOKEN_HEADER = "x-rakazo-desktop-stack-token";
let mainWindow: BrowserWindow | null = null;
const appWindowTargets = new WeakMap<BrowserWindow, string>();
let setupWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let openingSettings = false;
let settingsCleanup: Promise<void> = Promise.resolve();
let settingsTarget: { origin: string; token: string } | null = null;
const bundledRendererInstallations = new Set<string>();
let currentSetup: DesktopSetup | null = null;
let currentTargetUrl: string | null = null;
let setupError: string | null = null;
let setupSaveInProgress = false;
const appOpener = createAppOpener(openAppOnce);
/** Prior app window kept until setup is persisted (or the switch is abandoned). */
let pendingPreviousWindow: BrowserWindow | null = null;
let quitting = false;
let warmWindowTimer: NodeJS.Timeout | undefined;
// Number of short-lived hidden probe windows currently alive. On Windows/Linux,
// destroying the last window fires "window-all-closed" -> app.quit(); a probe
// that runs before the first real window exists must not count as "all closed".
let liveProbeWindows = 0;
const WARM_WINDOW_TTL_MS = warmWindowTtlMs(
  process.env.RAKAZO_WARM_WINDOW_TTL_MS,
);

const updaterEnvironment = {
  packaged: app.isPackaged,
  version: app.getVersion(),
  disabled: process.env.RAKAZO_DISABLE_AUTO_UPDATE === "1",
};
const desktopUpdater = new DesktopUpdateController(
  updaterEnvironment,
  async () => {
    const module = await import("electron-updater");
    return (module.default ?? module)
      .autoUpdater as unknown as ElectronAutoUpdater;
  },
  undefined,
  () => {
    quitting = false;
  },
);
let launchUpdateCheckScheduled = false;
let localStack: LocalStackController;
let hostComputer: Awaited<ReturnType<typeof prepareHostComputer>> | undefined;
let requestingComputerAccess = false;
let localRuntimeService: LocalRuntimeService | undefined;
let localRuntimeAccountId: string | null = null;
let localRuntimeGeneration = 0;
let localManifestRefreshTimer: ReturnType<typeof setInterval> | undefined;
const activeLocalRuns = new Set<string>();
let localModeContext:
  | {
      userDataDir: string;
      gatewayUrl?: string;
      developmentToken?: string;
    }
  | undefined;
let localAuth: LocalAuth | undefined;
let localWindow: BrowserWindow | null = null;
let localIpcInstalled = false;
let desktopBrowserBridge: DesktopBrowserBridge | undefined;
const approvedBrowserRuns = new Set<string>();
const pendingSecretRequests = new Map<
  string,
  {
    resolve: (value: { value: string; username?: string } | null) => void;
    timer: ReturnType<typeof setTimeout>;
    cleanup: () => void;
  }
>();
const pendingChoiceRequests = new Map<
  string,
  {
    resolve: (answer: string | null) => void;
    timer: ReturnType<typeof setTimeout>;
    cleanup: () => void;
  }
>();
const browserWriteTools = new Set([
  "browser_open",
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_scroll",
  "browser_borrow_tab",
]);

markOnce("rk:main:module-evaluated");
if (PERFORMANCE_USER_DATA) {
  app.setPath("userData", PERFORMANCE_USER_DATA);
  app.setPath("sessionData", path.join(PERFORMANCE_USER_DATA, "session"));
}
app.once("will-finish-launching", () =>
  markOnce("rk:main:will-finish-launching"),
);
app.once("ready", () => markOnce("rk:main:ready"));
// Includes fresh partitions and popup-created sessions, before they load remote content.
app.on("session-created", (value) =>
  installSessionPermissions(value, permissionTarget),
);

function permissionTarget() {
  if (mainWindow === null || mainWindow.isDestroyed()) return null;
  const url = appWindowTargets.get(mainWindow);
  return url === undefined
    ? null
    : { webContents: mainWindow.webContents, url };
}

function markOnce(name: string) {
  if (performance.getEntriesByName(name).length === 0) performance.mark(name);
}

function windowFrom(event: Electron.IpcMainInvokeEvent) {
  return BrowserWindow.fromWebContents(event.sender);
}

function fromMainWindow(event: Electron.IpcMainInvokeEvent) {
  return mainWindow !== null && windowFrom(event) === mainWindow;
}

/** Dock/taskbar icon for unpackaged launches; packaged builds get theirs from electron-builder. */
function developmentIcon() {
  if (app.isPackaged) return undefined;
  const icon = path.join(
    app.getAppPath(),
    "assets",
    developmentIconFile(process.platform),
  );
  return existsSync(icon) ? icon : undefined;
}

function sessionPartitionKey(targetUrl: string) {
  return sessionPartitionForServerUrl(targetUrl);
}

function legacyDefaultSessionFlag(partition: string) {
  return path.join(
    app.getPath("userData"),
    `legacy-default-${partition.replace(/[^a-zA-Z0-9_-]/g, "_")}.flag`,
  );
}

/**
 * Prefer the default session when that origin already has cookies or site
 * storage there, so upgrades keep localStorage/IndexedDB. Fresh origins get
 * an isolated partition.
 */
async function resolveSessionForTarget(targetUrl: string) {
  const partition = sessionPartitionKey(targetUrl);
  if (partition === null) {
    return { partition: null, value: session.defaultSession };
  }
  if (existsSync(legacyDefaultSessionFlag(partition))) {
    return { partition: null, value: session.defaultSession };
  }
  const origin = safeOrigin(targetUrl);
  if (origin !== null) {
    try {
      const defaultCookies = await session.defaultSession.cookies.get({
        url: origin,
      });
      if (defaultCookies.length > 0) {
        await writeFile(
          legacyDefaultSessionFlag(partition),
          new Date().toISOString(),
          "utf8",
        );
        return { partition: null, value: session.defaultSession };
      }
    } catch {
      // Continue with a storage probe when the profile looks pre-partition.
    }
    if (
      defaultSessionProfileExists() &&
      (await defaultSessionHasOriginData(origin))
    ) {
      try {
        await writeFile(
          legacyDefaultSessionFlag(partition),
          new Date().toISOString(),
          "utf8",
        );
      } catch {
        // Flag is best-effort; still stay on the default session this launch.
      }
      return { partition: null, value: session.defaultSession };
    }
  }
  return { partition, value: session.fromPartition(partition) };
}

function defaultSessionProfileExists() {
  const root = app.getPath("userData");
  return (
    existsSync(path.join(root, "Local Storage")) ||
    existsSync(path.join(root, "IndexedDB")) ||
    existsSync(path.join(root, "Cookies")) ||
    existsSync(path.join(root, "Network", "Cookies")) ||
    existsSync(path.join(root, "Cache Storage"))
  );
}

/** Page storage in the default session means a pre-partition install for this origin. */
async function defaultSessionHasOriginData(origin: string): Promise<boolean> {
  const probe = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  // Increment only after construction succeeds so a throw cannot leave the
  // counter stuck > 0 and permanently block quit on Windows/Linux.
  liveProbeWindows++;
  try {
    await probe.loadURL(origin);
    return (await probe.webContents.executeJavaScript(`(async () => {
      if (localStorage.length > 0 || sessionStorage.length > 0) return true;
      if (typeof indexedDB !== "undefined" && indexedDB.databases) {
        try {
          const databases = await indexedDB.databases();
          if (databases.length > 0) return true;
        } catch {}
      }
      if (typeof caches !== "undefined") {
        try {
          const keys = await caches.keys();
          if (keys.length > 0) return true;
        } catch {}
      }
      return false;
    })()`)) as boolean;
  } catch {
    return false;
  } finally {
    if (!probe.isDestroyed()) probe.destroy();
    liveProbeWindows--;
  }
}

function createWindow(url: string, partition: string | null) {
  markOnce("rk:main:window-create-start");
  const icon = developmentIcon();
  const win = new BrowserWindow({
    ...browserWindowOptions(process.platform),
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      ...(partition === null ? {} : { partition }),
    },
  });
  mainWindow = win;
  appWindowTargets.set(win, url);
  const targetOrigin = safeOrigin(url);
  // Intentional OAuth flows open the provider's authorize page via a named
  // window; give those and same-origin popups a normal frame. Everything else
  // opens in the system browser so a connected server cannot navigate us away.
  // Hoisted for loopback OAuth capture so MCP/in-app localhost callbacks are skipped.
  const appOrigin = targetOrigin ?? safeOrigin(url);
  win.webContents.setWindowOpenHandler(({ url: childUrl, frameName }) => {
    if (shouldOpenInAppPopup(appOrigin, childUrl, frameName)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: oauthPopupWindowOptions(partition),
      };
    }
    const external = safeExternalUrl(childUrl);
    if (external !== null) void shell.openExternal(external);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, navigationUrl) => {
    if (targetOrigin !== null && safeOrigin(navigationUrl) === targetOrigin)
      return;
    event.preventDefault();
    const external = safeExternalUrl(navigationUrl);
    if (external !== null) void shell.openExternal(external);
  });
  // The popup has no address bar, so a loopback redirect would otherwise strand
  // the user on a blank window holding the authorization code in a URL they
  // cannot read. Capture it here and hand it to the app instead.
  win.webContents.on("did-create-window", (popup, { frameName }) => {
    const capture = (details: {
      preventDefault: () => void;
      url: string;
      isMainFrame?: boolean;
    }) => {
      // will-redirect can fire for iframes; only the top-level callback counts.
      if (details.isMainFrame === false) return;
      const callback = oauthCallbackFrom(details.url, {
        frameName,
        excludeOrigins: appOrigin !== null ? [appOrigin] : [],
      });
      if (!callback) return;
      details.preventDefault();
      if (!win.isDestroyed())
        win.webContents.send("desktop.oauth.callback", callback);
      if (!popup.isDestroyed()) popup.close();
    };
    popup.webContents.on("will-redirect", (details) => capture(details));
    popup.webContents.on("will-navigate", (details) => capture(details));
  });
  win.on("close", (event) => {
    if (
      process.platform === "darwin" &&
      !quitting &&
      process.env.RAKAZO_DISABLE_WARM_WINDOW !== "1"
    ) {
      event.preventDefault();
      win.hide();
      clearTimeout(warmWindowTimer);
      warmWindowTimer = setTimeout(() => {
        if (mainWindow === win && !win.isDestroyed() && !win.isVisible())
          win.destroy();
      }, WARM_WINDOW_TTL_MS);
    }
  });
  win.once("closed", () => {
    clearTimeout(warmWindowTimer);
    if (mainWindow === win) mainWindow = null;
  });
  markOnce("rk:main:window-created");
  if (win.isVisible()) markOnce("rk:main:window-shown");
  win.once("show", () => markOnce("rk:main:window-shown"));
  win.once("ready-to-show", () => markOnce("rk:main:ready-to-show"));
  win.webContents.once("dom-ready", () => markOnce("rk:main:dom-ready"));
  win.webContents.once("did-finish-load", () =>
    markOnce("rk:main:did-finish-load"),
  );
  win.webContents.once("did-stop-loading", () =>
    markOnce("rk:main:did-stop-loading"),
  );
  markOnce("rk:main:load-url-start");
  const loaded = loadAppUrl(win, url).then(
    (state) => {
      markOnce("rk:main:load-url-resolved");
      return state;
    },
    (error: unknown) => {
      markOnce("rk:main:load-url-rejected");
      throw error;
    },
  );
  if (!launchUpdateCheckScheduled) {
    launchUpdateCheckScheduled = true;
    setTimeout(
      () => void desktopUpdater.check(false),
      LAUNCH_CHECK_DELAY_MS,
    ).unref();
    setInterval(
      () => void desktopUpdater.check(false),
      60 * 60 * 1_000,
    ).unref();
  }
  return { loaded, win };
}

async function probeDocument(url: string): Promise<string | null> {
  // Test/dev harnesses may load data: or file: documents; only probe real servers.
  if (!url.startsWith("http://") && !url.startsWith("https://")) return null;
  try {
    const response = await net.fetch(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // Allow 3xx (e.g. / → /login); reject hard HTTP errors before opening a window.
    if (response.status >= 400) {
      return `The server answered with HTTP ${response.status}.`;
    }
    return null;
  } catch (error) {
    return probeFailureMessage(error);
  }
}

/**
 * loadURL alone treats many HTTP error documents as success. Reject main-frame
 * failures, renderer crashes during load, HTTP 4xx/5xx main-frame responses, and
 * shells that never mount application content.
 */
function loadAppUrl(
  win: BrowserWindow,
  url: string,
): Promise<AppDocumentState> {
  const contents = win.webContents;
  const targetSession = contents.session;
  let mainStatus: number | undefined;

  targetSession.webRequest.onCompleted({ urls: ["*://*/*"] }, (details) => {
    if (
      details.webContentsId === contents.id &&
      details.resourceType === "mainFrame"
    ) {
      mainStatus = details.statusCode;
    }
  });

  return new Promise<AppDocumentState>((resolve, reject) => {
    let settled = false;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      contents.removeListener("did-fail-load", onFail);
      // Keep render-process-gone until document readiness finishes so a crash
      // during mount still fails the switch.
      targetSession.webRequest.onCompleted(null);
      if (error) {
        contents.removeListener("render-process-gone", onGone);
        reject(error);
        return;
      }
      if (mainStatus !== undefined && mainStatus >= 400) {
        contents.removeListener("render-process-gone", onGone);
        reject(new Error(`The server answered with HTTP ${mainStatus}.`));
        return;
      }
      void waitForMountedAppDocument(contents)
        .then((state) => {
          contents.removeListener("render-process-gone", onGone);
          if (contents.isCrashed()) {
            reject(new Error("Renderer stopped after load."));
            return;
          }
          resolve(state);
        })
        .catch((inspectError: unknown) => {
          contents.removeListener("render-process-gone", onGone);
          reject(
            inspectError instanceof Error
              ? inspectError
              : new Error(String(inspectError)),
          );
        });
    };

    const onFail = (
      _event: Electron.Event,
      _errorCode: number,
      errorDescription: string,
      _validatedURL: string,
      isMainFrame: boolean,
    ) => {
      if (isMainFrame)
        settle(new Error(errorDescription || "Page failed to load."));
    };
    const onGone = (
      _event: Electron.Event,
      details: Electron.RenderProcessGoneDetails,
    ) => {
      settle(new Error(`Renderer stopped (${details.reason}).`));
    };

    contents.on("did-fail-load", onFail);
    contents.on("render-process-gone", onGone);
    void contents.loadURL(url).then(
      async () => {
        // onCompleted can lag loadURL; wait briefly for the main-frame status.
        const deadline = Date.now() + 500;
        while (mainStatus === undefined && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 10));
        }
        settle();
      },
      (error: unknown) => {
        settle(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function waitForMountedAppDocument(
  contents: Electron.WebContents,
): Promise<AppDocumentState> {
  const deadline = Date.now() + APP_DOCUMENT_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (contents.isCrashed()) throw new Error("Renderer stopped after load.");
    const state = (await contents.executeJavaScript(
      APP_DOCUMENT_STATE_SCRIPT,
    )) as AppDocumentState | "pending";
    if (state !== "pending") return state;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("The server page did not become ready.");
}

async function installBundledRenderer(
  targetUrl: string,
  targetSession: Session,
  partition: string | null,
  managedLocalStack: boolean,
) {
  if (!app.isPackaged || process.env.RAKAZO_DISABLE_BUNDLED_RENDERER === "1")
    return;
  if (!servesBundledRenderer(targetUrl, managedLocalStack)) return;
  const webUrl = new URL(targetUrl);
  const installationKey = `${partition ?? "default"}:${webUrl.protocol}`;
  if (bundledRendererInstallations.has(installationKey)) return;
  const root = path.join(process.resourcesPath, "web");

  await targetSession.protocol.handle(
    webUrl.protocol.slice(0, -1),
    async (request) => {
      const forward = () => {
        return targetSession.fetch(
          request,
          forwardedRendererRequestInit(request, webUrl.origin),
        );
      };
      // Mode can change on the same origin/session; only managed "new" keeps the overlay.
      if (
        partition !== "local-server-settings" &&
        currentSetup?.mode !== "new"
      ) {
        return forward();
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return forward();
      }
      const acceptsHtml =
        request.headers.get("accept")?.includes("text/html") ?? false;
      const candidates = bundledRendererCandidates(
        root,
        request.url,
        webUrl.origin,
        acceptsHtml,
      );
      if (!candidates) return forward();
      for (const file of candidates) {
        let body: Buffer | null = null;
        try {
          if (request.method === "HEAD") {
            if (!(await stat(file)).isFile()) continue;
          } else {
            body = await readFile(file);
          }
        } catch (error) {
          if (isRendererAssetMiss(error)) continue;
          throw error;
        }
        const headers = new Headers({
          "cache-control": immutableRendererAsset(file)
            ? "public, max-age=31536000, immutable"
            : "no-cache",
          "content-type": contentType(file),
          "x-content-type-options": "nosniff",
        });
        return new Response(body === null ? null : new Uint8Array(body), {
          headers,
        });
      }
      return forward();
    },
  );
  bundledRendererInstallations.add(installationKey);
  markOnce("rk:main:bundled-renderer-ready");
}

function oauthPopupWindowOptions(partition: string | null) {
  return {
    width: 560,
    height: 720,
    frame: true,
    titleBarStyle: "default" as const,
    autoHideMenuBar: true,
    backgroundColor: "#0B0C0E",
    webPreferences: oauthPopupSessionPreferences(partition),
  };
}

function createSetupWindow() {
  const icon = developmentIcon();
  const win = new BrowserWindow({
    ...setupWindowOptions(process.platform),
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(import.meta.dirname, "setup-preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // A long pull runs while this window sits behind others; throttled timers would freeze it.
      backgroundThrottling: false,
    },
  });
  setupWindow = win;
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.once("closed", () => {
    if (setupWindow === win) setupWindow = null;
    // Closing setup without saving restores a connected session (Change Server cancel).
    restoreAppWindowAfterSetup();
  });
  void win.loadFile(path.join(import.meta.dirname, "setup.html"));
  markOnce("rk:main:setup-window-created");
  return win;
}

/** Hide the app while setup is open; do not clear the saved target until a new one opens. */
function showSetupWindow(error: string | null = null) {
  setupError = error;

  let win: BrowserWindow;
  if (setupWindow !== null && !setupWindow.isDestroyed()) {
    if (error !== null) setupWindow.reload();
    win = setupWindow;
  } else {
    win = createSetupWindow();
  }
  if (mainWindow !== null && !mainWindow.isDestroyed()) mainWindow.hide();
  win.show();
  win.focus();
  return win;
}

function restoreAppWindowAfterSetup() {
  if (quitting) return;
  if (setupWindow !== null && !setupWindow.isDestroyed()) return;
  if (
    mainWindow === null ||
    mainWindow.isDestroyed() ||
    currentTargetUrl === null
  )
    return;
  clearTimeout(warmWindowTimer);
  mainWindow.show();
  mainWindow.focus();
}

async function showLocalSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  if (openingSettings) return;
  openingSettings = true;
  try {
    const url = localStack.webUrl();
    const token = await readStackToken(stackDir(app.getPath("userData")));
    if (!token || !(await localStack.matchesDesiredStack(url))) {
      await dialog.showMessageBox({
        message: "Start the local server before opening its settings.",
        type: "info",
      });
      return;
    }
    await settingsCleanup;
    const partition = "local-server-settings";
    const targetSession = session.fromPartition(partition);
    installSessionPermissions(targetSession, () => null);
    await installBundledRenderer(url, targetSession, partition, true);
    const win = new BrowserWindow({
      ...browserWindowOptions(process.platform),
      title: "Local Server Settings",
      frame: true,
      titleBarStyle: "default",
      trafficLightPosition: undefined,
      webPreferences: {
        preload: path.join(import.meta.dirname, "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition,
      },
    });
    settingsWindow = win;
    const origin = new URL(url).origin;
    settingsTarget = { origin, token };
    win.webContents.setWindowOpenHandler(({ url: externalUrl }) => {
      const external = safeExternalUrl(externalUrl);
      if (external) void shell.openExternal(external);
      return { action: "deny" };
    });
    const preventNavigation = (event: Electron.Event, target: string) => {
      if (target === `${origin}${LOCAL_SETTINGS_PAGE}`) return;
      event.preventDefault();
    };
    win.webContents.on("will-navigate", preventNavigation);
    win.webContents.on("will-redirect", preventNavigation);
    win.once("closed", () => {
      if (settingsWindow === win) {
        settingsWindow = null;
        settingsTarget = null;
      }
      const protocol = new URL(url).protocol;
      if (bundledRendererInstallations.delete(`${partition}:${protocol}`)) {
        targetSession.protocol.unhandle(protocol.slice(0, -1));
      }
      settingsCleanup = targetSession.clearStorageData().catch(() => undefined);
    });
    await win.loadURL(`${origin}${LOCAL_SETTINGS_PAGE}`);
  } catch {
    settingsWindow?.close();
    await dialog.showMessageBox({
      message: "Could not open local server settings. Try again.",
      type: "error",
    });
  } finally {
    openingSettings = false;
  }
}

function installApplicationMenu() {
  const computerAccess: Electron.MenuItemConstructorOptions = {
    label: "Computer Access…",
    visible: currentSetup?.mode === "new",
    click: () => mainWindow?.webContents.send("desktop.computer.configure"),
  };
  const revokeComputerAccess: Electron.MenuItemConstructorOptions = {
    label: "Revoke Local Computer Access",
    visible: hostComputer?.isEnabled() === true,
    click: () => {
      void hostComputer
        ?.revoke()
        .finally(() => installApplicationMenu())
        .catch(() => undefined);
    },
  };
  const localSettings: Electron.MenuItemConstructorOptions = {
    id: "local-server-settings",
    label: "Local Server Settings…",
    accelerator: "CmdOrCtrl+,",
    click: () => {
      void showLocalSettings();
    },
  };
  const changeServer: Electron.MenuItemConstructorOptions = {
    id: "change-rakazo-server",
    label: "Change ericBot Server…",
    accelerator: "CmdOrCtrl+Shift+K",
    click: () => showSetupWindow(),
  };
  const stopStack: Electron.MenuItemConstructorOptions = {
    id: "stop-local-stack",
    label: "Stop Local Stack",
    // The stack keeps running after quit (bots are always on); this is the explicit off switch.
    click: () => {
      if (currentSetup?.mode === "new") {
        hostComputer?.activate(false);
        installApplicationMenu();
        void localStack.stop();
      }
    },
  };
  const template: Electron.MenuItemConstructorOptions[] =
    process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              localSettings,
              computerAccess,
              revokeComputerAccess,
              changeServer,
              stopStack,
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
          { role: "editMenu" },
          { role: "windowMenu" },
        ]
      : [
          {
            label: "File",
            submenu: [
              localSettings,
              computerAccess,
              revokeComputerAccess,
              changeServer,
              stopStack,
              { type: "separator" },
              { role: "quit" },
            ],
          },
          { role: "editMenu" },
          { role: "windowMenu" },
        ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Setup IPC must only answer the setup window, never a connected Rakazo server. */
function fromSetupWindow(event: Electron.IpcMainInvokeEvent) {
  return (
    setupWindow !== null &&
    !setupWindow.isDestroyed() &&
    event.sender === setupWindow.webContents
  );
}

async function probeServer(
  rawUrl: string,
  signal?: AbortSignal,
): Promise<DesktopReachability> {
  const url = normalizeServerUrl(rawUrl);
  if (url === null)
    return { ok: false, error: "Enter a valid http:// or https:// address." };
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);

  try {
    const response = await net.fetch(`${url}/rpc/health`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: {} }),
      cache: "no-store",
      credentials: "omit",
      redirect: "manual",
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false,
        status: response.status,
        url,
        error:
          "That address redirects elsewhere. Enter the final ericBot server address.",
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        url,
        error: `The server answered with HTTP ${response.status}.`,
      };
    }
    const health = await readProbeJson(response);
    if (!isRakazoHealth(health)) {
      return {
        ok: false,
        status: response.status,
        url,
        error: "That address did not respond like an ericBot server.",
      };
    }
    return {
      ok: true,
      status: response.status,
      url,
    };
  } catch (error) {
    return { ok: false, url, error: probeFailureMessage(error) };
  }
}

/** A public health response is not enough: another checkout may own the same fixed port. */
async function probeManagedStack(
  rawUrl: string,
  token: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const url = normalizeServerUrl(rawUrl);
  // Never put the private stack token on a cleartext LAN or .local hop.
  if (url === null || !maySendDesktopStackToken(url)) return null;
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  try {
    const response = await net.fetch(`${url}${DESKTOP_STACK_PROBE_PATH}`, {
      method: "GET",
      headers: { [DESKTOP_STACK_TOKEN_HEADER]: token },
      cache: "no-store",
      credentials: "omit",
      redirect: "manual",
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
    if (!response.ok) return null;
    return desktopStackImageTag(await readProbeJson(response));
  } catch {
    return null;
  }
}

function openFailureDetail(error: unknown): string {
  if (error instanceof Error) {
    const { message } = error;
    if (
      message.startsWith("The server answered with HTTP") ||
      message.startsWith("The server page loaded empty") ||
      message.startsWith("The server page did not become ready") ||
      message.startsWith("Renderer stopped") ||
      message.startsWith("Page failed to load")
    ) {
      return message;
    }
  }
  return probeFailureMessage(error);
}

async function openAppOnce(targetUrl: string, switching: boolean) {
  hostComputer?.activate(
    currentSetup?.mode === "new" && targetUrl === localStack.webUrl(),
  );
  const target = await resolveSessionForTarget(targetUrl);
  const previous = mainWindow;
  let win: BrowserWindow | null = null;
  try {
    const documentError = await probeDocument(targetUrl);
    if (documentError !== null) {
      throw new Error(documentError);
    }
    await installBundledRenderer(
      targetUrl,
      target.value,
      target.partition,
      currentSetup?.mode === "new",
    );
    const created = createWindow(targetUrl, target.partition);
    win = created.win;
    // On launch the web app's error screen stays up so its Refresh can recover;
    // switching to a server that cannot render keeps the previous one instead.
    if ((await created.loaded) === "failed" && switching) {
      throw new Error("The server page did not become ready.");
    }
    currentTargetUrl = targetUrl;
    setupError = null;
    // Keep the previous window until the caller commits (after setup.json is written).
    pendingPreviousWindow =
      previous !== null && !previous.isDestroyed() && previous !== win
        ? previous
        : null;
    if (pendingPreviousWindow !== null) pendingPreviousWindow.hide();
    return true;
  } catch (error) {
    pendingPreviousWindow = null;
    // Keep the previous app window so Cancel / close can restore it.
    if (previous !== null && !previous.isDestroyed()) mainWindow = previous;
    // Show the setup window BEFORE destroying the failed one: on Windows/Linux,
    // destroying the last window fires "window-all-closed" -> app.quit() before
    // showSetupWindow() runs, so the app silently exits instead of showing this error.
    showSetupWindow(`Could not open that server. ${openFailureDetail(error)}`);
    if (win !== null && !win.isDestroyed()) win.destroy();
    return false;
  }
}

function syncHostComputerAccess() {
  hostComputer?.activate(
    currentSetup?.mode === "new" &&
      mainWindow !== null &&
      !mainWindow.isDestroyed() &&
      appWindowTargets.get(mainWindow) === localStack.webUrl(),
  );
  installApplicationMenu();
}

function requireLocalRuntime(): LocalRuntimeService {
  if (!localRuntimeService) throw new Error("Local runtime is not ready");
  return localRuntimeService;
}

async function closeLocalRuntime(): Promise<void> {
  localRuntimeGeneration += 1;
  if (localManifestRefreshTimer) clearInterval(localManifestRefreshTimer);
  localManifestRefreshTimer = undefined;
  const service = localRuntimeService;
  localRuntimeService = undefined;
  localRuntimeAccountId = null;
  await abortActiveLocalRuns(service);
  service?.close();
}

function cleanupLocalRun(runId: string) {
  activeLocalRuns.delete(runId);
  approvedBrowserRuns.delete(runId);
  void desktopBrowserBridge?.closeSession(runId).catch(() => undefined);
}

async function abortActiveLocalRuns(
  service = localRuntimeService,
): Promise<void> {
  const runs = [...activeLocalRuns];
  if (service) {
    await Promise.allSettled(runs.map((runId) => service.abort(runId)));
  }
  for (const runId of runs) cleanupLocalRun(runId);
}

async function startLocalRuntime(accountId: string): Promise<void> {
  if (!localModeContext) throw new Error("Local mode is not ready");
  if (localRuntimeService && localRuntimeAccountId === accountId) return;
  await closeLocalRuntime();
  const generation = ++localRuntimeGeneration;
  const context = localModeContext;
  const service = await createDesktopLocalRuntime({
    userDataDir: context.userDataDir,
    accountId,
    ...(desktopBrowserBridge ? { browserHost: desktopBrowserBridge } : {}),
    secretVault: createSafeStorageSecretVault(
      path.join(
        context.userDataDir,
        "local",
        "accounts",
        localAccountKey(accountId),
        "credentials-v1.bin",
      ),
    ),
    promptForSecret: requestSecretFromRenderer,
    promptForUserChoice: requestChoiceFromRenderer,
    allowPrivateHttpSecretOrigins:
      process.env.RAKAZO_SECRETS_ALLOW_PRIVATE_HTTP === "1",
    openFile: (target) => shell.openPath(target),
    openUrl: (url) => shell.openExternal(url),
    launchApp: launchLocalApplication,
    enableTicketTools: process.env.RAKAZO_ENABLE_TICKET_TOOLS === "1",
    approveTool: async ({ name, runId, args }) => {
      const browserWrite = browserWriteTools.has(name);
      const browserBorrow = name === "browser_borrow_tab";
      if (
        browserWrite &&
        !browserBorrow &&
        runId !== undefined &&
        approvedBrowserRuns.has(runId)
      ) {
        return true;
      }
      const detail =
        name === "shell" && typeof args.command === "string"
          ? args.command.slice(0, 4_000)
          : browserWrite
            ? `${name}\n\nBrowser actions run in a visible Chrome window with the profile's existing website sign-ins. Page content is untrusted.`
            : JSON.stringify(args).slice(0, 4_000);
      const options = {
        type: "warning" as const,
        title: browserWrite
          ? "Allow browser interaction?"
          : "Allow local tool?",
        message: browserBorrow
          ? "The agent wants to take over one of your existing Chrome tabs."
          : `The agent wants to use ${name}.`,
        detail,
        buttons: [
          browserBorrow ? "Take over tab" : "Allow for this task",
          "Cancel",
        ],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      };
      const result =
        localWindow === null || localWindow.isDestroyed()
          ? await dialog.showMessageBox(options)
          : await dialog.showMessageBox(localWindow, options);
      const approved = result.response === 0;
      if (approved && browserWrite && runId !== undefined) {
        approvedBrowserRuns.add(runId);
      }
      return approved;
    },
    onRunStart: (run) => {
      activeLocalRuns.add(run.runId);
      if (localWindow !== null && !localWindow.isDestroyed()) {
        localWindow.webContents.send("desktop.local.run.started", run);
      }
    },
    onEvent: (event, runId) => {
      if (localWindow !== null && !localWindow.isDestroyed()) {
        localWindow.webContents.send("desktop.local.run.event", {
          runId,
          event,
        });
      }
    },
    onRunEnd: ({ runId }) => {
      cleanupLocalRun(runId);
    },
    resolveModel: async (bot) => {
      if (!context.gatewayUrl)
        throw new Error("The local model gateway is not configured.");
      const token = localAuth
        ? await localAuth.getToken()
        : context.developmentToken;
      if (!token) throw new Error("Sign in to connect the model gateway.");
      const defaultModelId =
        localRuntimeService?.getUserSettings().defaultModelId;
      return defaultLocalModel({
        baseUrl: `${context.gatewayUrl.replace(/\/+$/, "")}/v1/model/openai`,
        apiKey: token,
        bot,
        ...(defaultModelId ? { fallbackModelId: defaultModelId } : {}),
      });
    },
  });
  if (
    generation !== localRuntimeGeneration ||
    localWindow === null ||
    localWindow.isDestroyed()
  ) {
    service.close();
    throw new Error("Local runtime start was cancelled");
  }
  localRuntimeService = service;
  localRuntimeAccountId = accountId;
  await refreshClientManifest(service, generation);
  if (localManifestRefreshTimer) clearInterval(localManifestRefreshTimer);
  localManifestRefreshTimer = setInterval(
    () => void refreshClientManifest(service, generation),
    5 * 60_000,
  );
  localManifestRefreshTimer.unref?.();
}

async function refreshClientManifest(
  service: LocalRuntimeService,
  generation: number,
): Promise<void> {
  if (!localModeContext?.gatewayUrl || !localAuth) return;
  try {
    const manifest = await fetchClientManifest({
      serverUrl: localModeContext.gatewayUrl,
      token: await localAuth.getToken(),
    });
    if (
      generation !== localRuntimeGeneration ||
      localRuntimeService !== service
    )
      return;
    const publicKey = process.env.RAKAZO_CLIENT_MANIFEST_PUBLIC_KEY?.trim();
    if (
      manifest &&
      (!publicKey || !verifyClientManifest(manifest, publicKey))
    ) {
      throw new Error("Client manifest signature is missing or invalid");
    }
    const current = service.getManagedManifestState();
    if (manifest?.hash === current?.hash) return;
    const state = manifest
      ? service.applyClientManifest(manifest)
      : service.clearManagedManifest()
        ? null
        : current;
    if (localWindow !== null && !localWindow.isDestroyed()) {
      localWindow.webContents.send("desktop.local.manifest.updated", state);
    }
  } catch {
    // Keep the last verified local preset during transient server or network failures.
  }
}

function requireLocalAuth(): LocalAuth {
  if (!localAuth) throw new Error("Server URL is not configured");
  return localAuth;
}

function requireLocalWindow(event: IpcMainInvokeEvent): void {
  if (
    localWindow === null ||
    localWindow.isDestroyed() ||
    event.sender !== localWindow.webContents ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error("Local window is not active");
  }
}

function requestSecretFromRenderer(
  input: Omit<DesktopLocalSecretRequest, "requestId">,
  signal?: AbortSignal,
): Promise<{ value: string; username?: string } | null> {
  if (localWindow === null || localWindow.isDestroyed()) {
    return Promise.reject(new Error("Local window is not active"));
  }
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const finish = (value: { value: string; username?: string } | null) => {
      const pending = pendingSecretRequests.get(requestId);
      if (!pending) return;
      pendingSecretRequests.delete(requestId);
      clearTimeout(pending.timer);
      pending.cleanup();
      resolve(value);
    };
    const cancel = () => {
      const pending = pendingSecretRequests.get(requestId);
      if (!pending) return;
      pendingSecretRequests.delete(requestId);
      clearTimeout(pending.timer);
      pending.cleanup();
      reject(new Error("Run stopped."));
    };
    const timer = setTimeout(() => {
      pendingSecretRequests.delete(requestId);
      signal?.removeEventListener("abort", cancel);
      reject(new Error("Credential request timed out"));
    }, 5 * 60_000);
    const cleanup = () => signal?.removeEventListener("abort", cancel);
    pendingSecretRequests.set(requestId, { resolve: finish, timer, cleanup });
    signal?.addEventListener("abort", cancel, { once: true });
    localWindow!.webContents.send("desktop.local.secrets.request", {
      requestId,
      ...input,
    } satisfies DesktopLocalSecretRequest);
  });
}

function requestChoiceFromRenderer(
  question: string,
  options: string[],
  signal?: AbortSignal,
): Promise<string | null> {
  if (localWindow === null || localWindow.isDestroyed()) {
    return Promise.reject(new Error("Local window is not active"));
  }
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const finish = (answer: string | null) => {
      const pending = pendingChoiceRequests.get(requestId);
      if (!pending) return;
      pendingChoiceRequests.delete(requestId);
      clearTimeout(pending.timer);
      pending.cleanup();
      resolve(answer);
    };
    const cancel = () => {
      const pending = pendingChoiceRequests.get(requestId);
      if (!pending) return;
      pendingChoiceRequests.delete(requestId);
      clearTimeout(pending.timer);
      pending.cleanup();
      reject(new Error("Run stopped."));
    };
    const timer = setTimeout(() => {
      pendingChoiceRequests.delete(requestId);
      signal?.removeEventListener("abort", cancel);
      reject(new Error("User question timed out"));
    }, 5 * 60_000);
    const cleanup = () => signal?.removeEventListener("abort", cancel);
    pendingChoiceRequests.set(requestId, { resolve: finish, timer, cleanup });
    signal?.addEventListener("abort", cancel, { once: true });
    localWindow!.webContents.send("desktop.local.choice.request", {
      requestId,
      question,
      options,
    } satisfies DesktopLocalChoiceRequest);
  });
}

function localRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalLocalRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  return value === undefined ? {} : localRecord(value, label);
}

const LOCAL_SCRATCHPAD_STATUSES = ["open", "parked", "done"] as const;
const LOCAL_TICKET_STATUSES = [
  "todo",
  "doing",
  "review",
  "blocked",
  "done",
  "closed",
] as const;
const LOCAL_TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

function localString(value: unknown, label: string, maxLength: number): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > maxLength
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function localMessageText(value: unknown): string {
  if (typeof value !== "string" || value.length > 100_000) {
    throw new Error("Message is invalid");
  }
  return value;
}

function optionalLocalString(
  value: unknown,
  label: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function nullableLocalString(
  value: unknown,
  label: string,
  maxLength: number,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = optionalLocalString(value, label, maxLength);
  return normalized?.trim() || null;
}

function localBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} is invalid`);
  return value;
}

function localEnum<T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label} is invalid`);
  }
  return value as T;
}

function localStringArray(
  value: unknown,
  label: string,
  minLength: number,
  maxLength: number,
): string[] {
  if (
    !Array.isArray(value) ||
    value.length < minLength ||
    value.length > maxLength ||
    value.some((entry) => typeof entry !== "string" || entry.trim() === "")
  ) {
    throw new Error(
      `${label} must contain ${minLength} to ${maxLength} entries`,
    );
  }
  return [...new Set(value.map((entry) => (entry as string).trim()))];
}

function optionalLocalSkillScripts(
  value: unknown,
): LocalSkillScriptInput[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20)
    throw new Error("Skill scripts are invalid");
  return value.map((entry) => {
    const script = localRecord(entry, "Skill script");
    const runtime = script.runtime;
    if (
      runtime !== undefined &&
      runtime !== null &&
      runtime !== "node" &&
      runtime !== "python3" &&
      runtime !== "sh"
    ) {
      throw new Error("Skill script runtime is invalid");
    }
    const rawTimeout = script.timeoutSeconds;
    const timeoutSeconds =
      typeof rawTimeout === "number" && Number.isInteger(rawTimeout)
        ? rawTimeout
        : undefined;
    if (
      rawTimeout !== undefined &&
      (timeoutSeconds === undefined ||
        timeoutSeconds < 1 ||
        timeoutSeconds > 120)
    ) {
      throw new Error("Skill script timeout is invalid");
    }
    if (script.network !== undefined && typeof script.network !== "boolean") {
      throw new Error("Skill script network setting is invalid");
    }
    return {
      path: localString(script.path, "Skill script path", 200).trim(),
      content:
        optionalLocalString(script.content, "Skill script content", 200_000) ??
        "",
      ...(runtime === undefined ? {} : { runtime }),
      ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
      ...(script.network === undefined ? {} : { network: script.network }),
    };
  });
}

function localSecretAuth(value: unknown): DesktopLocalSecretAuth {
  const auth = localRecord(value, "Credential authentication");
  if (auth.type === "bearer") return { type: "bearer" };
  if (auth.type === "login") return { type: "login" };
  if (auth.type === "command") return { type: "command" };
  if (auth.type === "header") {
    return {
      type: "header",
      name: localString(auth.name, "Credential header", 120).trim(),
    };
  }
  if (auth.type === "basic") {
    return {
      type: "basic",
      username: localString(auth.username, "Credential username", 200),
    };
  }
  throw new Error("Credential authentication type is invalid");
}

function localRoutineInput(
  value: unknown,
  required: true,
): {
  name: string;
  prompt: string;
  cron: string;
  timezone?: string;
  enabled?: boolean;
  runAt?: string;
};
function localRoutineInput(
  value: unknown,
  required: false,
): {
  name?: string;
  prompt?: string;
  cron?: string;
  timezone?: string;
  enabled?: boolean;
  runAt?: string;
};
function localRoutineInput(value: unknown, required: boolean) {
  const input = localRecord(value, "Routine");
  const name =
    input.name === undefined && !required
      ? undefined
      : localString(input.name, "Routine name", 80).trim();
  const prompt =
    input.prompt === undefined && !required
      ? undefined
      : localString(input.prompt, "Routine prompt", 100_000);
  const cron =
    input.cron === undefined && !required
      ? undefined
      : localString(input.cron, "Routine schedule", 200).trim();
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
    throw new Error("Routine enabled is invalid");
  }
  return {
    ...(name === undefined ? {} : { name }),
    ...(prompt === undefined ? {} : { prompt }),
    ...(cron === undefined ? {} : { cron }),
    ...(input.timezone === undefined
      ? {}
      : {
          timezone: localString(input.timezone, "Routine timezone", 100).trim(),
        }),
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    ...(input.runAt === undefined
      ? {}
      : { runAt: localString(input.runAt, "Routine run time", 100) }),
  };
}

function installLocalIpc() {
  if (localIpcInstalled) return;
  localIpcInstalled = true;

  ipcMain.handle("desktop.local.auth.status", async (event) => {
    requireLocalWindow(event);
    return localAuth
      ? localAuth.status()
      : {
          signedIn: false,
          serverUrl: null,
          userId: null,
          email: null,
          name: null,
        };
  });
  ipcMain.handle(
    "desktop.local.auth.login",
    async (event, email: unknown, password: unknown) => {
      requireLocalWindow(event);
      const session = await requireLocalAuth().signIn(
        localString(email, "Email", 320),
        localString(password, "Password", 1000),
      );
      try {
        await startLocalRuntime(session.userId);
      } catch (error) {
        await requireLocalAuth()
          .signOut()
          .catch(() => undefined);
        throw error;
      }
    },
  );
  ipcMain.handle(
    "desktop.local.auth.signUp",
    async (event, name: unknown, email: unknown, password: unknown) => {
      requireLocalWindow(event);
      const session = await requireLocalAuth().signUp(
        localString(name, "Name", 200),
        localString(email, "Email", 320),
        localString(password, "Password", 1000),
      );
      try {
        await startLocalRuntime(session.userId);
      } catch (error) {
        await requireLocalAuth()
          .signOut()
          .catch(() => undefined);
        throw error;
      }
    },
  );
  ipcMain.handle("desktop.local.auth.logout", async (event) => {
    requireLocalWindow(event);
    await closeLocalRuntime();
    await requireLocalAuth().signOut();
  });
  ipcMain.handle("desktop.local.bots.list", (event) => {
    requireLocalWindow(event);
    return requireLocalRuntime().listBots();
  });
  ipcMain.handle("desktop.local.bots.archived", (event) => {
    requireLocalWindow(event);
    return requireLocalRuntime().listArchivedBots();
  });
  ipcMain.handle("desktop.local.bots.restore", (event, botId: unknown) => {
    requireLocalWindow(event);
    return requireLocalRuntime().restoreBot(localString(botId, "Bot id", 200));
  });
  ipcMain.handle(
    "desktop.local.bots.deleteArchived",
    (event, botId: unknown) => {
      requireLocalWindow(event);
      if (
        !requireLocalRuntime().deleteArchivedBot(
          localString(botId, "Bot id", 200),
        )
      ) {
        throw new Error("Archived bot not found");
      }
    },
  );
  ipcMain.handle("desktop.local.bots.create", (event, input: unknown) => {
    requireLocalWindow(event);
    const value = localRecord(input, "Bot input");
    return requireLocalRuntime().createBot({
      name: localString(value.name, "Bot name", 120),
      title: optionalLocalString(value.title, "Bot title", 200),
      description: optionalLocalString(
        value.description,
        "Bot description",
        2000,
      ),
      instructions: optionalLocalString(
        value.instructions,
        "Bot instructions",
        40_000,
      ),
      color: optionalLocalString(value.color, "Bot color", 40),
      modelProvider:
        nullableLocalString(value.modelProvider, "Model provider", 200) ?? null,
      modelId: nullableLocalString(value.modelId, "Model id", 300) ?? null,
      thinkingLevel:
        nullableLocalString(value.thinkingLevel, "Thinking level", 40) ?? null,
      fleetManagement:
        value.fleetManagement === undefined
          ? false
          : localBoolean(value.fleetManagement, "Fleet management"),
    });
  });
  ipcMain.handle(
    "desktop.local.bots.update",
    (event, botId: unknown, input: unknown) => {
      requireLocalWindow(event);
      const id = localString(botId, "Bot id", 200);
      if (requireLocalRuntime().db.bots.get(id)?.source === "managed") {
        throw new Error("This bot is managed by your organization");
      }
      const value = localRecord(input, "Bot input");
      const updated = requireLocalRuntime().db.bots.update(id, {
        ...(value.name === undefined
          ? {}
          : { name: localString(value.name, "Bot name", 120) }),
        ...(value.title === undefined
          ? {}
          : {
              title: optionalLocalString(value.title, "Bot title", 200) ?? "",
            }),
        ...(value.description === undefined
          ? {}
          : {
              description:
                optionalLocalString(
                  value.description,
                  "Bot description",
                  2000,
                ) ?? "",
            }),
        ...(value.instructions === undefined
          ? {}
          : {
              instructions:
                optionalLocalString(
                  value.instructions,
                  "Bot instructions",
                  40_000,
                ) ?? "",
            }),
        ...(value.modelId === undefined
          ? {}
          : {
              modelId:
                nullableLocalString(value.modelId, "Model id", 300) ?? null,
            }),
        ...(value.thinkingLevel === undefined
          ? {}
          : {
              thinkingLevel:
                nullableLocalString(
                  value.thinkingLevel,
                  "Thinking level",
                  40,
                ) ?? null,
            }),
        ...(value.fleetManagement === undefined
          ? {}
          : {
              fleetManagement: localBoolean(
                value.fleetManagement,
                "Fleet management",
              ),
            }),
      });
      if (!updated) throw new Error("Bot not found");
      return updated;
    },
  );
  ipcMain.handle("desktop.local.messages.list", (event, botId: unknown) => {
    requireLocalWindow(event);
    return requireLocalRuntime().listMessages(
      localString(botId, "Bot id", 200),
    );
  });
  ipcMain.handle(
    "desktop.local.messages.send",
    async (event, botId: unknown, text: unknown, artifactIds: unknown) => {
      requireLocalWindow(event);
      return requireLocalRuntime().sendMessage(
        localString(botId, "Bot id", 200),
        localMessageText(text),
        {},
        artifactIds === undefined
          ? []
          : localStringArray(artifactIds, "Attachments", 0, 4),
      );
    },
  );
  ipcMain.handle("desktop.local.groups.list", (event) => {
    requireLocalWindow(event);
    return requireLocalRuntime().listGroups();
  });
  ipcMain.handle("desktop.local.groups.create", (event, input: unknown) => {
    requireLocalWindow(event);
    const value = localRecord(input, "Group input");
    const botIds = localStringArray(value.botIds, "Group members", 2, 10);
    if (botIds.length < 2) throw new Error("A group needs 2 to 10 bots");
    return requireLocalRuntime().createGroup({
      name: localString(value.name, "Group name", 120),
      description: optionalLocalString(
        value.description,
        "Group description",
        2_000,
      ),
      color: optionalLocalString(value.color, "Group color", 40),
      botIds,
    });
  });
  ipcMain.handle(
    "desktop.local.groups.update",
    (event, groupId: unknown, input: unknown) => {
      requireLocalWindow(event);
      const id = localString(groupId, "Group id", 200);
      const value = localRecord(input, "Group input");
      const updated = requireLocalRuntime().updateGroup(id, {
        ...(value.name === undefined
          ? {}
          : { name: localString(value.name, "Group name", 120) }),
        ...(value.description === undefined
          ? {}
          : {
              description:
                optionalLocalString(
                  value.description,
                  "Group description",
                  2_000,
                ) ?? "",
            }),
        ...(value.color === undefined
          ? {}
          : {
              color:
                optionalLocalString(value.color, "Group color", 40) ?? "violet",
            }),
        ...(value.botIds === undefined
          ? {}
          : { botIds: localStringArray(value.botIds, "Group members", 2, 10) }),
      });
      if (!updated) throw new Error("Group not found");
      return updated;
    },
  );
  ipcMain.handle("desktop.local.groups.remove", (event, groupId: unknown) => {
    requireLocalWindow(event);
    if (
      !requireLocalRuntime().removeGroup(localString(groupId, "Group id", 200))
    ) {
      throw new Error("Group not found");
    }
  });
  ipcMain.handle(
    "desktop.local.groups.messages.list",
    (event, groupId: unknown) => {
      requireLocalWindow(event);
      return requireLocalRuntime().listGroupMessages(
        localString(groupId, "Group id", 200),
      );
    },
  );
  ipcMain.handle(
    "desktop.local.groups.messages.send",
    async (event, groupId: unknown, text: unknown, artifactIds: unknown) => {
      requireLocalWindow(event);
      return requireLocalRuntime().sendGroupMessage(
        localString(groupId, "Group id", 200),
        localMessageText(text),
        {},
        artifactIds === undefined
          ? []
          : localStringArray(artifactIds, "Attachments", 0, 4),
      );
    },
  );
  ipcMain.handle(
    "desktop.local.groups.cancel",
    async (event, groupId: unknown) => {
      requireLocalWindow(event);
      await requireLocalRuntime().cancelGroup(
        localString(groupId, "Group id", 200),
      );
    },
  );
  ipcMain.handle("desktop.local.runs.cancel", async (event, runId: unknown) => {
    requireLocalWindow(event);
    await requireLocalRuntime().abort(localString(runId, "Run id", 200));
  });
  ipcMain.handle("desktop.local.settings.get", (event) => {
    requireLocalWindow(event);
    return requireLocalRuntime().getUserSettings();
  });
  ipcMain.handle("desktop.local.settings.update", (event, input: unknown) => {
    requireLocalWindow(event);
    const value = localRecord(input, "Settings");
    if (
      value.theme !== undefined &&
      value.theme !== "system" &&
      value.theme !== "light" &&
      value.theme !== "dark"
    ) {
      throw new Error("Theme is invalid");
    }
    if (
      value.sendWithEnter !== undefined &&
      typeof value.sendWithEnter !== "boolean"
    ) {
      throw new Error("Send preference is invalid");
    }
    return requireLocalRuntime().updateUserSettings({
      ...(value.theme === undefined ? {} : { theme: value.theme }),
      ...(value.sendWithEnter === undefined
        ? {}
        : { sendWithEnter: value.sendWithEnter }),
      ...(value.defaultModelId === undefined
        ? {}
        : {
            defaultModelId:
              nullableLocalString(value.defaultModelId, "Default model", 300) ??
              null,
          }),
    });
  });
  ipcMain.handle("desktop.local.workspace.open", async (event) => {
    requireLocalWindow(event);
    const workspacePath = requireLocalRuntime().getWorkspacePath();
    await mkdir(workspacePath, { recursive: true });
    const error = await shell.openPath(workspacePath);
    if (error) throw new Error(error);
  });
  ipcMain.handle("desktop.local.browser.status", (event) => {
    requireLocalWindow(event);
    if (!desktopBrowserBridge) {
      return {
        available: false,
        connected: false,
        port: null,
        error: "Browser bridge is not initialized",
        clientVersion: null,
      };
    }
    return desktopBrowserBridge.status();
  });
  ipcMain.handle("desktop.local.browser.startPairing", (event) => {
    requireLocalWindow(event);
    if (!desktopBrowserBridge)
      throw new Error("Browser bridge is not initialized");
    return desktopBrowserBridge.startPairing();
  });
  ipcMain.handle("desktop.local.browser.revoke", async (event) => {
    requireLocalWindow(event);
    if (!desktopBrowserBridge)
      throw new Error("Browser bridge is not initialized");
    await desktopBrowserBridge.revoke();
    return desktopBrowserBridge.status();
  });
  ipcMain.handle("desktop.local.diagnostics.copy", async (event) => {
    requireLocalWindow(event);
    const auth = localAuth ? await localAuth.status() : null;
    clipboard.writeText(
      JSON.stringify(
        createLocalDiagnostics({
          now: new Date(),
          version: app.getVersion(),
          packaged: app.isPackaged,
          platform: process.platform,
          arch: process.arch,
          account: auth
            ? {
                serverUrl: auth.serverUrl,
                signedIn: auth.signedIn,
              }
            : null,
          runtime: {
            ready: localRuntimeService !== undefined,
            activeRuns: activeLocalRuns.size,
          },
          browser: desktopBrowserBridge?.status() ?? null,
          update: desktopUpdater.state(),
        }),
        null,
        2,
      ),
    );
  });
  ipcMain.handle("desktop.local.activity.list", (event, limit: unknown) => {
    requireLocalWindow(event);
    if (
      limit !== undefined &&
      (!Number.isInteger(limit) ||
        (limit as number) < 1 ||
        (limit as number) > 200)
    ) {
      throw new Error("Activity limit must be between 1 and 200");
    }
    return requireLocalRuntime().listActivity(
      (limit as number | undefined) ?? 50,
    );
  });
  ipcMain.handle("desktop.local.memory.list", (event, input: unknown) => {
    requireLocalWindow(event);
    const value =
      input === undefined ? {} : localRecord(input, "Memory filter");
    if (
      value.scope !== undefined &&
      value.scope !== "bot" &&
      value.scope !== "user"
    ) {
      throw new Error("Memory scope is invalid");
    }
    return requireLocalRuntime().listMemory({
      ...(value.scope === undefined ? {} : { scope: value.scope }),
      ...(value.botId === undefined
        ? {}
        : { botId: localString(value.botId, "Bot id", 200) }),
    });
  });
  ipcMain.handle(
    "desktop.local.memory.update",
    (
      event,
      documentId: unknown,
      content: unknown,
      expectedRevision: unknown,
    ) => {
      requireLocalWindow(event);
      if (typeof content !== "string" || content.length > 100_000) {
        throw new Error("Memory content is invalid");
      }
      if (
        expectedRevision !== undefined &&
        (!Number.isInteger(expectedRevision) ||
          (expectedRevision as number) < 1)
      ) {
        throw new Error("Memory revision is invalid");
      }
      return requireLocalRuntime().updateMemory(
        localString(documentId, "Memory id", 200),
        content,
        expectedRevision as number | undefined,
      );
    },
  );
  ipcMain.handle(
    "desktop.local.memory.remove",
    (event, documentId: unknown) => {
      requireLocalWindow(event);
      if (
        !requireLocalRuntime().removeMemory(
          localString(documentId, "Memory id", 200),
        )
      ) {
        throw new Error("Memory document not found");
      }
    },
  );
  ipcMain.handle("desktop.local.routines.list", (event, botId: unknown) => {
    requireLocalWindow(event);
    return requireLocalRuntime().listRoutines(
      localString(botId, "Bot id", 200),
    );
  });
  ipcMain.handle(
    "desktop.local.routines.create",
    (event, botId: unknown, input: unknown) => {
      requireLocalWindow(event);
      return requireLocalRuntime().createRoutine(
        localString(botId, "Bot id", 200),
        localRoutineInput(input, true),
      );
    },
  );
  ipcMain.handle(
    "desktop.local.routines.update",
    (event, routineId: unknown, input: unknown) => {
      requireLocalWindow(event);
      return requireLocalRuntime().updateRoutine(
        localString(routineId, "Routine id", 200),
        localRoutineInput(input, false),
      );
    },
  );
  ipcMain.handle(
    "desktop.local.routines.remove",
    (event, routineId: unknown) => {
      requireLocalWindow(event);
      if (
        !requireLocalRuntime().removeRoutine(
          localString(routineId, "Routine id", 200),
        )
      ) {
        throw new Error("Routine not found");
      }
    },
  );
  ipcMain.handle(
    "desktop.local.routines.runNow",
    (event, routineId: unknown) => {
      requireLocalWindow(event);
      return requireLocalRuntime().runRoutineNow(
        localString(routineId, "Routine id", 200),
      );
    },
  );
  ipcMain.handle(
    "desktop.local.routines.history",
    (event, routineId: unknown, limit: unknown) => {
      requireLocalWindow(event);
      if (
        limit !== undefined &&
        (!Number.isInteger(limit) ||
          (limit as number) < 1 ||
          (limit as number) > 100)
      ) {
        throw new Error("Routine history limit must be between 1 and 100");
      }
      return requireLocalRuntime().listRoutineRuns(
        localString(routineId, "Routine id", 200),
        limit as number | undefined,
      );
    },
  );
  ipcMain.handle("desktop.local.artifacts.create", (event, input: unknown) => {
    requireLocalWindow(event);
    const value = localRecord(input, "Attachment");
    if (
      typeof value.contentBase64 !== "string" ||
      value.contentBase64.length === 0 ||
      value.contentBase64.length > ATTACHMENT_MAX_BASE64_LENGTH
    ) {
      throw new Error("Attachment content is invalid");
    }
    const botId =
      value.botId === undefined
        ? undefined
        : localString(value.botId, "Bot id", 200);
    const groupId =
      value.groupId === undefined
        ? undefined
        : localString(value.groupId, "Group id", 200);
    if ((botId ? 1 : 0) + (groupId ? 1 : 0) !== 1) {
      throw new Error("Attachment must belong to one bot or one group");
    }
    return requireLocalRuntime().createArtifact({
      ...(botId ? { botId } : {}),
      ...(groupId ? { groupId } : {}),
      name: localString(value.name, "Attachment name", 255),
      mimeType: localString(value.mimeType, "Attachment type", 100),
      contentBase64: value.contentBase64,
    });
  });
  ipcMain.handle(
    "desktop.local.artifacts.read",
    (event, artifactId: unknown) => {
      requireLocalWindow(event);
      return requireLocalRuntime().readArtifact(
        localString(artifactId, "Attachment id", 200),
      );
    },
  );
  ipcMain.handle("desktop.local.artifacts.list", (event, input: unknown) => {
    requireLocalWindow(event);
    const value = optionalLocalRecord(input, "Artifact filters");
    const botId =
      value.botId === undefined
        ? undefined
        : localString(value.botId, "Bot id", 200);
    const groupId =
      value.groupId === undefined
        ? undefined
        : localString(value.groupId, "Group id", 200);
    if (botId && groupId)
      throw new Error("Filter artifacts by one bot or one group");
    if (
      value.limit !== undefined &&
      (!Number.isInteger(value.limit) ||
        (value.limit as number) < 1 ||
        (value.limit as number) > 200)
    ) {
      throw new Error("Artifact limit must be between 1 and 200");
    }
    return requireLocalRuntime().listArtifacts({
      ...(botId ? { botId } : {}),
      ...(groupId ? { groupId } : {}),
      ...(value.limit === undefined ? {} : { limit: value.limit as number }),
      ...(value.cursor === undefined
        ? {}
        : { cursor: localString(value.cursor, "Artifact cursor", 200) }),
    });
  });
  ipcMain.handle(
    "desktop.local.artifacts.remove",
    (event, artifactId: unknown) => {
      requireLocalWindow(event);
      requireLocalRuntime().removeArtifact(
        localString(artifactId, "Attachment id", 200),
      );
    },
  );
  ipcMain.handle(
    "desktop.local.scratchpad.list",
    (event, botId: unknown, includeDone: unknown) => {
      requireLocalWindow(event);
      if (includeDone !== undefined && typeof includeDone !== "boolean") {
        throw new Error("Scratchpad includeDone is invalid");
      }
      return requireLocalRuntime().listScratchpad(
        localString(botId, "Bot id", 200),
        includeDone === true,
      );
    },
  );
  ipcMain.handle(
    "desktop.local.scratchpad.create",
    (event, botId: unknown, input: unknown) => {
      requireLocalWindow(event);
      const value = localRecord(input, "Scratchpad item");
      return requireLocalRuntime().createScratchpad(
        localString(botId, "Bot id", 200),
        {
          title: localString(value.title, "Scratchpad title", 500).trim(),
          ...(localEnum(
            value.status,
            "Scratchpad status",
            LOCAL_SCRATCHPAD_STATUSES,
          ) === undefined
            ? {}
            : {
                status: localEnum(
                  value.status,
                  "Scratchpad status",
                  LOCAL_SCRATCHPAD_STATUSES,
                )!,
              }),
          ...(value.notes === undefined
            ? {}
            : {
                notes:
                  optionalLocalString(
                    value.notes,
                    "Scratchpad notes",
                    20_000,
                  ) ?? "",
              }),
        },
      );
    },
  );
  ipcMain.handle(
    "desktop.local.scratchpad.update",
    (event, botId: unknown, itemId: unknown, input: unknown) => {
      requireLocalWindow(event);
      const value = localRecord(input, "Scratchpad item");
      const title = optionalLocalString(value.title, "Scratchpad title", 500);
      const status = localEnum(
        value.status,
        "Scratchpad status",
        LOCAL_SCRATCHPAD_STATUSES,
      );
      const notes = optionalLocalString(
        value.notes,
        "Scratchpad notes",
        20_000,
      );
      return requireLocalRuntime().updateScratchpad(
        localString(botId, "Bot id", 200),
        localString(itemId, "Scratchpad item id", 200),
        {
          ...(title === undefined ? {} : { title: title.trim() }),
          ...(status === undefined ? {} : { status }),
          ...(notes === undefined ? {} : { notes }),
        },
      );
    },
  );
  ipcMain.handle(
    "desktop.local.scratchpad.remove",
    (event, botId: unknown, itemId: unknown) => {
      requireLocalWindow(event);
      requireLocalRuntime().removeScratchpad(
        localString(botId, "Bot id", 200),
        localString(itemId, "Scratchpad item id", 200),
      );
    },
  );
  ipcMain.handle("desktop.local.tickets.list", (event, input: unknown) => {
    requireLocalWindow(event);
    const value = optionalLocalRecord(input, "Ticket filters");
    if (
      value.beforeSequence !== undefined &&
      (!Number.isInteger(value.beforeSequence) ||
        (value.beforeSequence as number) < 1)
    ) {
      throw new Error("Ticket cursor is invalid");
    }
    return requireLocalRuntime().listTickets({
      ...(localEnum(value.status, "Ticket status", LOCAL_TICKET_STATUSES) ===
      undefined
        ? {}
        : {
            status: localEnum(
              value.status,
              "Ticket status",
              LOCAL_TICKET_STATUSES,
            )!,
          }),
      ...(value.ownerBotId === undefined
        ? {}
        : { ownerBotId: localString(value.ownerBotId, "Owner bot id", 200) }),
      ...(value.beforeSequence === undefined
        ? {}
        : { beforeSequence: value.beforeSequence as number }),
    });
  });
  ipcMain.handle(
    "desktop.local.tickets.comments",
    (event, ticketId: unknown) => {
      requireLocalWindow(event);
      return requireLocalRuntime().listTicketComments(
        localString(ticketId, "Ticket id", 200),
      );
    },
  );
  ipcMain.handle("desktop.local.tickets.create", (event, input: unknown) => {
    requireLocalWindow(event);
    const value = localRecord(input, "Ticket");
    const ownerBotId =
      value.ownerBotId === undefined
        ? undefined
        : localString(value.ownerBotId, "Owner bot id", 200);
    const priority = localEnum(
      value.priority,
      "Ticket priority",
      LOCAL_TICKET_PRIORITIES,
    );
    return requireLocalRuntime().createTicket({
      botId: localString(value.botId, "Bot id", 200),
      ...(ownerBotId ? { ownerBotId } : {}),
      title: localString(value.title, "Ticket title", 200).trim(),
      ...(value.description === undefined
        ? {}
        : {
            description:
              optionalLocalString(
                value.description,
                "Ticket description",
                20_000,
              ) ?? "",
          }),
      ...(priority ? { priority } : {}),
    });
  });
  ipcMain.handle(
    "desktop.local.tickets.update",
    (event, ticketId: unknown, input: unknown) => {
      requireLocalWindow(event);
      const value = localRecord(input, "Ticket");
      const title = optionalLocalString(value.title, "Ticket title", 200);
      const description = optionalLocalString(
        value.description,
        "Ticket description",
        20_000,
      );
      const priority = localEnum(
        value.priority,
        "Ticket priority",
        LOCAL_TICKET_PRIORITIES,
      );
      const status = localEnum(
        value.status,
        "Ticket status",
        LOCAL_TICKET_STATUSES,
      );
      const ownerBotId =
        value.ownerBotId === undefined
          ? undefined
          : localString(value.ownerBotId, "Owner bot id", 200);
      return requireLocalRuntime().updateTicket(
        localString(ticketId, "Ticket id", 200),
        {
          ...(title === undefined ? {} : { title: title.trim() }),
          ...(description === undefined ? {} : { description }),
          ...(priority === undefined ? {} : { priority }),
          ...(status === undefined ? {} : { status }),
          ...(ownerBotId === undefined ? {} : { ownerBotId }),
        },
      );
    },
  );
  ipcMain.handle(
    "desktop.local.tickets.comment",
    (event, ticketId: unknown, botId: unknown, body: unknown) => {
      requireLocalWindow(event);
      return requireLocalRuntime().commentOnTicket(
        localString(ticketId, "Ticket id", 200),
        localString(botId, "Bot id", 200),
        localString(body, "Ticket comment", 20_000).trim(),
      );
    },
  );
  ipcMain.handle("desktop.local.knowledge.list", (event) => {
    requireLocalWindow(event);
    return requireLocalRuntime().listKnowledge();
  });
  ipcMain.handle("desktop.local.knowledge.create", (event, input: unknown) => {
    requireLocalWindow(event);
    const value = localRecord(input, "Knowledge document");
    return requireLocalRuntime().createKnowledge({
      title: localString(value.title, "Knowledge title", 200).trim(),
      content: localString(value.content, "Knowledge content", 500_000),
    });
  });
  ipcMain.handle(
    "desktop.local.knowledge.update",
    (event, documentId: unknown, input: unknown) => {
      requireLocalWindow(event);
      const value = localRecord(input, "Knowledge document");
      return requireLocalRuntime().updateKnowledge(
        localString(documentId, "Knowledge id", 200),
        {
          ...(value.title === undefined
            ? {}
            : {
                title: localString(value.title, "Knowledge title", 200).trim(),
              }),
          ...(value.content === undefined
            ? {}
            : {
                content: localString(
                  value.content,
                  "Knowledge content",
                  500_000,
                ),
              }),
        },
      );
    },
  );
  ipcMain.handle(
    "desktop.local.knowledge.remove",
    (event, documentId: unknown) => {
      requireLocalWindow(event);
      if (
        !requireLocalRuntime().removeKnowledge(
          localString(documentId, "Knowledge id", 200),
        )
      ) {
        throw new Error("Knowledge document not found or read-only");
      }
    },
  );
  ipcMain.handle("desktop.local.skills.list", (event) => {
    requireLocalWindow(event);
    return requireLocalRuntime().listSkills();
  });
  ipcMain.handle("desktop.local.skills.create", (event, input: unknown) => {
    requireLocalWindow(event);
    const value = localRecord(input, "Skill");
    return requireLocalRuntime().createSkill({
      name: localString(value.name, "Skill name", 80).trim(),
      description: localString(
        value.description,
        "Skill description",
        2_000,
      ).trim(),
      body: optionalLocalString(value.body, "Skill body", 100_000) ?? "",
      scripts: optionalLocalSkillScripts(value.scripts) ?? [],
    });
  });
  ipcMain.handle(
    "desktop.local.skills.update",
    (event, name: unknown, input: unknown) => {
      requireLocalWindow(event);
      const value = localRecord(input, "Skill");
      return requireLocalRuntime().updateSkill(
        localString(name, "Skill name", 80).trim(),
        {
          ...(value.newName === undefined
            ? {}
            : { newName: localString(value.newName, "Skill name", 80).trim() }),
          ...(value.description === undefined
            ? {}
            : {
                description: localString(
                  value.description,
                  "Skill description",
                  2_000,
                ).trim(),
              }),
          ...(value.body === undefined
            ? {}
            : {
                body:
                  optionalLocalString(value.body, "Skill body", 100_000) ?? "",
              }),
          ...(value.scripts === undefined
            ? {}
            : { scripts: optionalLocalSkillScripts(value.scripts) }),
        },
      );
    },
  );
  ipcMain.handle("desktop.local.skills.remove", (event, name: unknown) => {
    requireLocalWindow(event);
    if (
      !requireLocalRuntime().removeSkill(
        localString(name, "Skill name", 80).trim(),
      )
    ) {
      throw new Error("Skill not found");
    }
  });
  ipcMain.handle("desktop.local.secrets.list", (event, botId: unknown) => {
    requireLocalWindow(event);
    return requireLocalRuntime().listSecrets(localString(botId, "Bot id", 200));
  });
  ipcMain.handle(
    "desktop.local.secrets.put",
    (event, botId: unknown, input: unknown) => {
      requireLocalWindow(event);
      const value = localRecord(input, "Credential");
      return requireLocalRuntime().putSecret(
        localString(botId, "Bot id", 200),
        {
          name: localString(value.name, "Credential name", 64).trim(),
          origin:
            optionalLocalString(value.origin, "Credential origin", 2_048) ?? "",
          auth: localSecretAuth(value.auth),
          value: localString(value.value, "Credential value", 16_384),
        },
      );
    },
  );
  ipcMain.handle(
    "desktop.local.secrets.remove",
    (event, botId: unknown, name: unknown) => {
      requireLocalWindow(event);
      return requireLocalRuntime()
        .removeSecret(
          localString(botId, "Bot id", 200),
          localString(name, "Credential name", 64).trim(),
        )
        .then((removed) => {
          if (!removed) throw new Error("Credential not found");
        });
    },
  );
  ipcMain.handle(
    "desktop.local.secrets.respond",
    (event, requestId: unknown, response: unknown) => {
      requireLocalWindow(event);
      const id = localString(requestId, "Credential request", 200);
      const pending = pendingSecretRequests.get(id);
      if (!pending) throw new Error("Credential request is no longer active");
      if (response === null) {
        pending.resolve(null);
        return;
      }
      const answer = localRecord(response, "Credential response");
      pending.resolve({
        value: localString(answer.value, "Credential value", 16_384),
        ...(answer.username === undefined
          ? {}
          : {
              username:
                optionalLocalString(
                  answer.username,
                  "Credential username",
                  512,
                ) ?? "",
            }),
      });
    },
  );
  ipcMain.handle(
    "desktop.local.choice.respond",
    (event, requestId: unknown, answer: unknown) => {
      requireLocalWindow(event);
      const id = localString(requestId, "Choice request", 200);
      const pending = pendingChoiceRequests.get(id);
      if (!pending) throw new Error("Choice request is no longer active");
      pending.resolve(
        answer === null ? null : localString(answer, "Choice answer", 80),
      );
    },
  );
  ipcMain.handle("desktop.local.manifest.state", (event) => {
    requireLocalWindow(event);
    return requireLocalRuntime().getManagedManifestState();
  });
}

async function openLocalMode(userDataDir: string) {
  const serverUrl =
    process.env.RAKAZO_SERVER_URL?.trim() ||
    (app.isPackaged ? undefined : "http://127.0.0.1:3100");
  const auth = serverUrl
    ? new LocalAuth({
        serverUrl,
        vault: createSafeStorageVault(userDataDir),
      })
    : undefined;
  localAuth = auth;
  const gatewayUrl = serverUrl ?? process.env.RAKAZO_MODEL_GATEWAY_URL?.trim();
  const developmentToken = process.env.RAKAZO_DEV_MODEL_GATEWAY_TOKEN?.trim();
  localModeContext = { userDataDir, gatewayUrl, developmentToken };
  installLocalIpc();
  desktopBrowserBridge = new DesktopBrowserBridge({ userDataDir });
  await desktopBrowserBridge.start();

  const icon = developmentIcon();
  const win = new BrowserWindow({
    ...browserWindowOptions(process.platform),
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  localWindow = win;
  win.webContents.setWindowOpenHandler(({ url }) => {
    const external = safeExternalUrl(url);
    if (external !== null) void shell.openExternal(external);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    const external = safeExternalUrl(url);
    if (external !== null) void shell.openExternal(external);
  });
  win.once("closed", () => {
    if (localWindow === win) localWindow = null;
    void closeLocalRuntime();
    void desktopBrowserBridge?.close();
    desktopBrowserBridge = undefined;
    approvedBrowserRuns.clear();
    localModeContext = undefined;
    localAuth = undefined;
  });

  if (auth) {
    const status = await auth.status();
    if (status.signedIn && status.userId)
      await startLocalRuntime(status.userId);
  } else {
    await startLocalRuntime("development");
  }
  await win.loadFile(path.join(import.meta.dirname, "local-web/local.html"));
}

/** Drop the previous app window after the new server is opened and persisted. */
function commitPendingAppSwitch() {
  syncHostComputerAccess();
  const previous = pendingPreviousWindow;
  pendingPreviousWindow = null;
  if (previous !== null && !previous.isDestroyed() && previous !== mainWindow)
    previous.destroy();
}

/**
 * Undo an open that could not be persisted. When a prior session exists, restore
 * it. On first run keep the connected window so the user can retry save.
 */
function abandonPendingAppSwitch(
  previousSetup: DesktopSetup | null,
  previousUrl: string | null,
): "restored" | "kept" {
  const previous = pendingPreviousWindow;
  pendingPreviousWindow = null;
  if (previous !== null && !previous.isDestroyed()) {
    const failed = mainWindow;
    if (failed !== null && !failed.isDestroyed() && failed !== previous)
      failed.destroy();
    mainWindow = previous;
    currentSetup = previousSetup;
    currentTargetUrl = previousUrl;
    syncHostComputerAccess();
    // If setup was already closed (e.g. during a slow write), make the restored
    // session visible — otherwise macOS can be left with no shown window.
    if (setupWindow === null || setupWindow.isDestroyed()) {
      clearTimeout(warmWindowTimer);
      previous.show();
      previous.focus();
    }
    return "restored";
  }
  return "kept";
}

/** Watch for a renderer crash until setup is persisted (or the switch is abandoned). */
function watchRendererUntilCommitted(win: BrowserWindow) {
  let crashed = false;
  const onGone = () => {
    crashed = true;
  };
  win.webContents.once("render-process-gone", onGone);
  return {
    crashed: () =>
      crashed || (!win.isDestroyed() && win.webContents.isCrashed()),
    dispose: () => {
      if (!win.isDestroyed())
        win.webContents.removeListener("render-process-gone", onGone);
    },
  };
}

function destroySetupWindow() {
  const setup = setupWindow;
  setupWindow = null;
  if (setup !== null && !setup.isDestroyed()) setup.destroy();
}

/** Best-effort restore of setup.json after a failed save that already wrote disk. */
async function rollbackSetupFile(
  userDataDir: string,
  previousSetup: DesktopSetup | null,
) {
  try {
    if (previousSetup !== null) await writeSetup(userDataDir, previousSetup);
    else await clearSetup(userDataDir);
  } catch {
    // Disk rollback is best-effort; callers already restored in-memory state when possible.
  }
}

/**
 * After a renderer crash around save: restore prior setup when possible, otherwise
 * drop the crashed first-run window so setup remains the only recovery surface.
 */
async function recoverFromCrashedSave(
  userDataDir: string,
  previousSetup: DesktopSetup | null,
  previousUrl: string | null,
): Promise<string> {
  const outcome = abandonPendingAppSwitch(previousSetup, previousUrl);
  await rollbackSetupFile(userDataDir, previousSetup);
  if (outcome === "kept") {
    if (mainWindow !== null && !mainWindow.isDestroyed()) mainWindow.destroy();
    mainWindow = null;
    currentSetup = previousSetup;
    currentTargetUrl = previousUrl;
  }
  const message =
    previousSetup !== null
      ? "Could not open that server. Renderer stopped. The previous instance was restored for the next launch."
      : "Could not open that server. Renderer stopped.";
  showSetupWindow(message);
  return message;
}

function safeOrigin(targetUrl: string) {
  try {
    return new URL(targetUrl).origin;
  } catch {
    return null;
  }
}

app.whenReady().then(async () => {
  installSessionPermissions(session.defaultSession, permissionTarget);
  const userDataDir = app.getPath("userData");
  const savedSetup = await readSetup(userDataDir);
  if (
    usesLocalUiOnStartup({
      envUrl: process.env.RAKAZO_WEB_URL,
      localUi: process.env.RAKAZO_LOCAL_UI,
      legacySetup: process.env.RAKAZO_LEGACY_SETUP,
      forceSetup: process.env.RAKAZO_FORCE_SETUP === "1",
      saved: savedSetup,
    })
  ) {
    await openLocalMode(userDataDir);
    return;
  }
  try {
    hostComputer = await prepareHostComputer(userDataDir);
  } catch {
    /* Local access fails closed; Docker remains available. */
  }
  localStack = new LocalStackController({
    hostComputer: hostComputer?.connection,
    platform: process.platform,
    env: process.env,
    exists: existsSync,
    run: runDocker,
    stackDir: stackDir(userDataDir),
    resourceDir: stackResourceDir({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    }),
    localWebUrl:
      process.env.RAKAZO_LOCAL_WEB_URL?.trim() ||
      (await readStackWebUrl(stackDir(userDataDir), LOCAL_WEB_URL)),
    imageTag: resolveImageTag({
      version: app.getVersion(),
      packaged: app.isPackaged,
      override: process.env.RAKAZO_IMAGE_TAG,
    }),
    probe: (url, signal, token) => probeManagedStack(url, token, signal),
    randomHex: (bytes) => randomBytes(bytes).toString("hex"),
    onState: (state) => {
      if (setupWindow !== null && !setupWindow.isDestroyed()) {
        setupWindow.webContents.send("desktop.setup.stack.changed", state);
      }
    },
  });
  currentSetup = savedSetup;
  const target = resolveStartupTarget({
    envUrl: process.env.RAKAZO_WEB_URL,
    saved: currentSetup,
    forceSetup: process.env.RAKAZO_FORCE_SETUP === "1",
  });
  if (process.env.RAKAZO_PERFORMANCE_CLEAR_CACHE === "1") {
    const cacheSessions = new Set<Session>([session.defaultSession]);
    if (target.kind === "app") {
      cacheSessions.add((await resolveSessionForTarget(target.url)).value);
    }
    await Promise.all(
      [...cacheSessions].flatMap((value) => [
        value.clearCache(),
        value.clearCodeCaches({}),
      ]),
    );
    markOnce("rk:main:caches-cleared");
  }

  const icon = developmentIcon();
  if (process.platform === "darwin" && icon) app.dock?.setIcon(icon);
  installApplicationMenu();
  const browserAuthAttempts = new Map<string, AbortController>();
  const cancelBrowserAuth = () => {
    for (const attempt of browserAuthAttempts.values()) attempt.abort();
    browserAuthAttempts.clear();
  };
  app.on("before-quit", cancelBrowserAuth);
  ipcMain.handle("desktop.oauth.open", async (event, url: unknown) => {
    if (
      (!fromMainWindow(event) &&
        !(settingsWindow !== null && windowFrom(event) === settingsWindow)) ||
      event.senderFrame !== event.sender.mainFrame ||
      typeof url !== "string" ||
      url.length > 16_384
    )
      throw new Error("Invalid sign-in request.");
    if (browserAuthAttempts.has(url) || browserAuthAttempts.size >= 8) {
      throw new Error(
        "A sign-in attempt is already active. Cancel it and retry.",
      );
    }
    const controller = new AbortController();
    browserAuthAttempts.set(url, controller);
    const stop = () => controller.abort();
    const expiry = setTimeout(stop, 10 * 60_000);
    expiry.unref();
    event.sender.once("destroyed", stop);
    event.sender.once("did-navigate", stop);
    controller.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(expiry);
        event.sender.removeListener("destroyed", stop);
        event.sender.removeListener("did-navigate", stop);
        if (browserAuthAttempts.get(url) === controller)
          browserAuthAttempts.delete(url);
      },
      { once: true },
    );
    try {
      await openBrowserAuth(url, {
        signal: controller.signal,
        onClose: stop,
        openExternal: (target) => shell.openExternal(target),
        onCallback: (callback) => {
          if (!event.sender.isDestroyed())
            event.sender.send("desktop.oauth.callback", callback);
        },
      });
    } catch {
      controller.abort();
      throw new Error(
        "Could not open browser sign-in. Close other sign-in attempts and retry.",
      );
    }
  });
  ipcMain.handle("desktop.oauth.cancel", (event, url: unknown) => {
    if (
      (!fromMainWindow(event) &&
        !(settingsWindow !== null && windowFrom(event) === settingsWindow)) ||
      event.senderFrame !== event.sender.mainFrame ||
      typeof url !== "string"
    )
      return;
    browserAuthAttempts.get(url)?.abort();
  });
  ipcMain.handle(
    "desktop.localSettings.request",
    async (event, pathname: unknown, body: unknown) => {
      if (
        !settingsWindow ||
        windowFrom(event) !== settingsWindow ||
        event.senderFrame !== event.sender.mainFrame ||
        !settingsTarget ||
        event.senderFrame.url !==
          `${settingsTarget.origin}${LOCAL_SETTINGS_PAGE}`
      ) {
        throw new Error("Local settings are not active");
      }
      return requestLocalSettings(
        settingsTarget,
        pathname,
        body,
        (input, init) =>
          net.fetch(input instanceof URL ? input.href : input, {
            ...init,
            bypassCustomProtocolHandlers: true,
          }),
      );
    },
  );
  const isManagedComputerRequest = (event: Electron.IpcMainInvokeEvent) =>
    fromMainWindow(event) &&
    event.senderFrame === event.sender.mainFrame &&
    currentSetup?.mode === "new" &&
    appWindowTargets.get(mainWindow!) === localStack.webUrl() &&
    safeOrigin(event.senderFrame.url) === safeOrigin(localStack.webUrl());
  ipcMain.handle("desktop.computer.requestAccess", async (event) => {
    if (!isManagedComputerRequest(event) || !hostComputer)
      throw new Error(
        "Local computer access requires an app-managed local instance.",
      );
    if (requestingComputerAccess) return false;
    requestingComputerAccess = true;
    try {
      if (
        !(await localStack.matchesDesiredStack()) ||
        !isManagedComputerRequest(event)
      )
        return false;
      if (hostComputer.isEnabled()) return true;
      const result = await dialog.showMessageBox(mainWindow!, {
        type: "warning",
        title: "Allow local computer access?",
        message: "Allow bots to use this computer?",
        detail:
          "Bots on this local instance can run commands, read and change files, and launch apps with your account’s permissions. You can revoke access from the app menu.",
        buttons: ["Cancel", "Allow"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (result.response !== 1 || !isManagedComputerRequest(event))
        return false;
      hostComputer.activate(true);
      await hostComputer.grant();
      installApplicationMenu();
      return hostComputer.isEnabled();
    } finally {
      requestingComputerAccess = false;
    }
  });
  ipcMain.handle("desktop.computer.revokeAccess", async (event) => {
    if (isManagedComputerRequest(event)) {
      await hostComputer?.revoke();
      installApplicationMenu();
    }
  });
  ipcMain.handle("desktop.platform", () => process.platform);
  ipcMain.handle("desktop.window.close", (event) => {
    windowFrom(event)?.close();
  });
  ipcMain.handle("desktop.window.minimize", (event) => {
    windowFrom(event)?.minimize();
  });
  ipcMain.handle("desktop.window.toggleMaximize", (event) => {
    const win = windowFrom(event);
    if (!win) return;
    if (win.isMaximized() || win.isFullScreen()) {
      win.setFullScreen(false);
      if (win.isMaximized()) win.unmaximize();
    } else {
      win.maximize();
    }
  });
  ipcMain.handle("desktop.window.state", (event) => {
    const win = windowFrom(event);
    return {
      minimized: win?.isMinimized() ?? false,
      maximized: win?.isMaximized() ?? false,
      fullScreen: win?.isFullScreen() ?? false,
    };
  });
  ipcMain.handle("desktop.update.state", () => desktopUpdater.state());
  ipcMain.handle("desktop.update.check", (event) =>
    fromMainWindow(event) ? desktopUpdater.check(true) : desktopUpdater.state(),
  );
  ipcMain.handle("desktop.update.download", (event) =>
    fromMainWindow(event) ? desktopUpdater.download() : desktopUpdater.state(),
  );
  ipcMain.handle("desktop.update.install", async (event) => {
    if (!fromMainWindow(event) || desktopUpdater.state().phase !== "ready") {
      return desktopUpdater.state();
    }
    quitting = true;
    const state = await desktopUpdater.install();
    // A failed install stays ready for retry but reports a message. Restore normal
    // window behavior while the user keeps working after that failure.
    if (state.phase !== "ready" || state.message !== null) quitting = false;
    return state;
  });
  ipcMain.handle("desktop.setup.state", (event) => {
    if (!fromSetupWindow(event)) return null;
    return {
      defaultLocalUrl: localStack.webUrl(),
      saved: currentSetup,
      error: setupError ?? undefined,
    };
  });

  ipcMain.handle("desktop.setup.test", async (event, url: unknown) => {
    if (!fromSetupWindow(event))
      return { ok: false, error: "Setup is not active." };
    if (typeof url !== "string")
      return { ok: false, error: "Enter a server address." };
    return probeServer(url);
  });

  ipcMain.handle("desktop.setup.save", async (event, payload: unknown) => {
    if (!fromSetupWindow(event))
      return { ok: false, error: "Setup is not active." };
    // A launch still loading counts too: the switch must open and check its own server.
    if (setupSaveInProgress || appOpener.busy())
      return { ok: false, error: "A connection attempt is already running." };
    setupSaveInProgress = true;
    const previousSetup = currentSetup;
    const previousUrl = currentTargetUrl;
    try {
      const setup = parseSetupInput(payload);
      if (setup === null) {
        return {
          ok: false,
          error:
            "Enter a valid server address. Public servers require HTTPS; a new local instance must use localhost.",
        };
      }

      // Only open the exact origin selected and authenticated by the managed stack.
      let openSetup = setup;
      if (setup.mode === "new") {
        const managedUrl = managedLocalOpenUrl(
          setup.serverUrl,
          localStack.webUrl(),
        );
        if (managedUrl === null || !(await localStack.matchesDesiredStack())) {
          return {
            ok: false,
            error:
              "The app-managed ericBot services are not ready. Retry setup.",
          };
        }
        openSetup = { mode: "new", serverUrl: managedUrl };
      }

      const reachability = await probeServer(openSetup.serverUrl);
      if (!reachability.ok) return { ok: false, error: reachability.error };

      // Open before persisting so a failed renderer load keeps the last working setup.
      currentSetup = openSetup;
      const opened = await appOpener.open(openSetup.serverUrl, {
        switching: true,
      });
      if (!opened) {
        currentSetup = previousSetup;
        syncHostComputerAccess();
        return {
          ok: false,
          error:
            "Could not open that server. The previous instance was left unchanged.",
        };
      }

      const appWindow = mainWindow;
      const rendererWatch =
        appWindow !== null && !appWindow.isDestroyed()
          ? watchRendererUntilCommitted(appWindow)
          : null;
      try {
        await writeSetup(userDataDir, openSetup);
        if (rendererWatch?.crashed()) {
          const message = await recoverFromCrashedSave(
            userDataDir,
            previousSetup,
            previousUrl,
          );
          return { ok: false, error: message };
        }
        // Commit while the crash listener is still armed.
        commitPendingAppSwitch();
        if (rendererWatch?.crashed()) {
          const message = await recoverFromCrashedSave(
            userDataDir,
            previousSetup,
            previousUrl,
          );
          return { ok: false, error: message };
        }
        destroySetupWindow();
        // Final check after setup closes — a crash in this gap still rolls back.
        if (rendererWatch?.crashed()) {
          const message = await recoverFromCrashedSave(
            userDataDir,
            previousSetup,
            previousUrl,
          );
          return { ok: false, error: message };
        }
        return { ok: true };
      } catch {
        const outcome = abandonPendingAppSwitch(previousSetup, previousUrl);
        return {
          ok: false,
          error:
            outcome === "restored"
              ? "Could not save setup. The previous instance was restored."
              : "Connected, but could not save setup for the next launch. Try Continue again.",
        };
      } finally {
        rendererWatch?.dispose();
      }
    } finally {
      setupSaveInProgress = false;
    }
  });

  ipcMain.handle("desktop.setup.quit", (event) => {
    if (fromSetupWindow(event)) app.quit();
  });
  ipcMain.handle("desktop.setup.openLink", async (event, link: unknown) => {
    if (!fromSetupWindow(event) || !isDesktopSetupLink(link)) return;
    await shell.openExternal(DOCKER_INSTALL_LINKS[link]);
  });
  ipcMain.handle("desktop.setup.stack.state", (event) =>
    fromSetupWindow(event) ? localStack.state() : null,
  );
  ipcMain.handle("desktop.setup.stack.start", (event) => {
    if (!fromSetupWindow(event)) return null;
    // Respond right away; the setup window polls `stack.state` until a terminal phase.
    void localStack.start();
    return localStack.state();
  });

  // Register before startup awaits so macOS dock clicks during probe/open are handled.
  app.on("activate", () => {
    if (setupWindow !== null && !setupWindow.isDestroyed()) {
      setupWindow.show();
      setupWindow.focus();
      return;
    }
    if (mainWindow !== null && !mainWindow.isDestroyed()) {
      clearTimeout(warmWindowTimer);
      mainWindow.show();
      mainWindow.focus();
      return;
    }
    if (appOpener.busy()) return;
    if (currentTargetUrl === null) showSetupWindow(setupError);
    else
      void appOpener.open(currentTargetUrl).then((opened) => {
        if (opened) commitPendingAppSwitch();
      });
  });

  if (target.kind === "setup") {
    showSetupWindow();
  } else if (target.source === "saved") {
    if (currentSetup?.mode === "new") {
      const managedUrl = managedLocalOpenUrl(target.url, localStack.webUrl());
      const managedStackReady =
        managedUrl !== null ? await localStack.matchesDesiredStack() : false;
      if (managedStackReady && managedUrl !== null) {
        if (await appOpener.open(managedUrl)) {
          commitPendingAppSwitch();
          destroySetupWindow();
        }
      } else {
        // Missing, stale, foreign, or owned by another process: reconcile the
        // app-managed stack before any API or computer traffic is allowed.
        void localStack.start();
        showSetupWindow();
      }
    } else {
      const reachability = await probeServer(target.url);
      if (reachability.ok) {
        if (await appOpener.open(target.url)) {
          commitPendingAppSwitch();
          destroySetupWindow();
        }
      } else {
        showSetupWindow(
          `Could not reconnect to the saved server. ${reachability.error}`,
        );
      }
    }
  } else {
    if (await appOpener.open(target.url)) {
      commitPendingAppSwitch();
      destroySetupWindow();
    }
  }
});

app.on("window-all-closed", () => {
  // A hidden session probe (defaultSessionHasOriginData) can be the only window
  // during startup; its teardown must not quit the app.
  if (liveProbeWindows > 0) return;
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  quitting = true;
  clearTimeout(warmWindowTimer);
  void closeLocalRuntime();
  localModeContext = undefined;
  localAuth = undefined;
  // Containers keep running; only an in-flight pull/up is cut short.
  hostComputer?.activate(false);
  void hostComputer?.close();
  localStack?.abort();
});
