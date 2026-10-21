/**
 * `unsupported` covers an unpackaged build and a repository with no published releases, which is
 * the normal state for a fork. It is not an error the user needs to act on. Automatic checks stay
 * frozen after an empty feed; a manual check may retry when the install itself supports updates.
 */
export type DesktopUpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "unsupported"
  | "error";

export interface DesktopUpdateState {
  phase: DesktopUpdatePhase;
  /** The installed desktop release, which can drift from the server this app points at. */
  currentVersion: string;
  availableVersion: string | null;
  /** Download progress 0-100, only while `downloading`. */
  percent: number | null;
  message: string | null;
  checkedAt: string | null;
}

export interface RakazoDesktopUpdate {
  state: () => Promise<DesktopUpdateState>;
  check: () => Promise<DesktopUpdateState>;
  download: () => Promise<DesktopUpdateState>;
  /** Quits and relaunches into the downloaded release; only useful once `phase` is `ready`. */
  install: () => Promise<DesktopUpdateState>;
}

export interface RakazoDesktopOAuthCallback {
  code: string;
  state?: string;
}

export interface DesktopLocalBot {
  id: string;
  name: string;
  title: string;
  description: string;
  instructions: string;
  color: string;
  modelProvider: string | null;
  modelId: string | null;
  thinkingLevel: string | null;
  disabledBuiltinTools: string[];
  templateKey: string | null;
  templateVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopLocalMessage {
  id: string;
  threadId: string;
  sequence: number;
  role: "user" | "bot" | "system";
  blocks: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface DesktopLocalGroup {
  id: string;
  name: string;
  description: string;
  color: string;
  members: DesktopLocalBot[];
  createdAt: string;
  updatedAt: string;
}

export interface DesktopGroupMessage {
  id: string;
  threadId: string;
  sequence: number;
  role: "user" | "bot" | "system";
  botId: string | null;
  blocks: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface DesktopActivityTool {
  id: string;
  runId: string;
  executionId: string;
  botId: string;
  toolName: string;
  arguments: unknown;
  result: unknown;
  status: "running" | "completed" | "failed";
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface DesktopActivityRun {
  id: string;
  kind: "direct" | "group";
  botId: string;
  groupId: string | null;
  threadId: string;
  status: "running" | "completed" | "failed" | "stopped";
  error: string | null;
  startedAt: string;
  endedAt: string | null;
  tools: DesktopActivityTool[];
}

export interface DesktopLocalMemoryDocument {
  id: string;
  scope: "bot" | "user";
  botId: string | null;
  path: string;
  content: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface DesktopLocalCreateBotInput {
  name: string;
  title?: string;
  description?: string;
  instructions?: string;
  color?: string;
  modelProvider?: string | null;
  modelId?: string | null;
  thinkingLevel?: string | null;
  disabledBuiltinTools?: string[];
}

export interface DesktopLocalUserSettings {
  theme: "system" | "light" | "dark";
  sendWithEnter: boolean;
  defaultModelId: string | null;
}

export interface DesktopBrowserBridgeStatus {
  available: boolean;
  connected: boolean;
  port: number | null;
  error: string | null;
  clientVersion: string | null;
}

export interface DesktopBrowserPairingOffer {
  port: number;
  code: string;
  expires_at: string;
}

export interface DesktopLocalRunStarted {
  runId: string;
  botId: string;
  threadId: string;
  userMessageId: string;
}

export interface DesktopLocalRunEvent {
  runId: string;
  event: {
    type: string;
    text?: string;
    name?: string;
    args?: Record<string, unknown>;
    executionId?: string;
  };
}

export interface RakazoDesktopLocal {
  auth: {
    status: () => Promise<{
      signedIn: boolean;
      serverUrl: string | null;
      userId: string | null;
      email: string | null;
      name: string | null;
    }>;
    login: (email: string, password: string) => Promise<void>;
    signUp: (name: string, email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
  };
  bots: {
    list: () => Promise<DesktopLocalBot[]>;
    create: (input: DesktopLocalCreateBotInput) => Promise<DesktopLocalBot>;
    update: (botId: string, input: DesktopLocalCreateBotInput) => Promise<DesktopLocalBot>;
  };
  messages: {
    list: (botId: string) => Promise<DesktopLocalMessage[]>;
    send: (
      botId: string,
      text: string,
    ) => Promise<{
      thread: { id: string; botId: string; title: string; createdAt: string; updatedAt: string };
      userMessage: DesktopLocalMessage;
      assistantMessage: DesktopLocalMessage | null;
      text: string;
      runId: string;
      events: DesktopLocalRunEvent["event"][];
      toolCalls: Array<{
        executionId: string;
        name: string;
        arguments: Record<string, unknown>;
      }>;
    }>;
  };
  groups: {
    list: () => Promise<DesktopLocalGroup[]>;
    create: (input: {
      name: string;
      description?: string;
      color?: string;
      botIds: string[];
    }) => Promise<DesktopLocalGroup>;
    update: (
      groupId: string,
      input: {
        name?: string;
        description?: string;
        color?: string;
        botIds?: string[];
      },
    ) => Promise<DesktopLocalGroup>;
    remove: (groupId: string) => Promise<void>;
    messages: {
      list: (groupId: string) => Promise<DesktopGroupMessage[]>;
      send: (
        groupId: string,
        text: string,
      ) => Promise<{
        thread: { id: string; groupId: string; title: string };
        userMessage: DesktopGroupMessage;
        runs: Array<{
          runId: string;
          botId: string;
          text: string;
          failed: boolean;
        }>;
      }>;
    };
    cancel: (groupId: string) => Promise<void>;
  };
  runs: {
    cancel: (runId: string) => Promise<void>;
    onStarted: (listener: (run: DesktopLocalRunStarted) => void) => () => void;
    onEvent: (listener: (update: DesktopLocalRunEvent) => void) => () => void;
  };
  settings: {
    get: () => Promise<DesktopLocalUserSettings>;
    update: (input: Partial<DesktopLocalUserSettings>) => Promise<DesktopLocalUserSettings>;
  };
  browser: {
    status: () => Promise<DesktopBrowserBridgeStatus>;
    startPairing: () => Promise<DesktopBrowserPairingOffer>;
    revoke: () => Promise<DesktopBrowserBridgeStatus>;
  };
  diagnostics: {
    copy: () => Promise<void>;
  };
  activity: {
    list: (limit?: number) => Promise<DesktopActivityRun[]>;
  };
  memory: {
    list: (input?: {
      botId?: string;
      scope?: "bot" | "user";
    }) => Promise<DesktopLocalMemoryDocument[]>;
    update: (
      documentId: string,
      content: string,
      expectedRevision?: number,
    ) => Promise<DesktopLocalMemoryDocument>;
    remove: (documentId: string) => Promise<void>;
  };
}

export interface RakazoDesktop {
  computer?: {
    requestAccess: () => Promise<boolean>;
    revokeAccess: () => Promise<void>;
    onConfigure: (listener: () => void) => () => void;
  };
  /** Only the isolated local settings window is authorized to call this bridge. */
  localSettings?: {
    request: (pathname: string, body: string) => Promise<{ status: number; body: string }>;
  };
  platform: string;
  window: {
    close: () => Promise<void>;
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    state: () => Promise<{ minimized: boolean; maximized: boolean; fullScreen: boolean }>;
  };
  update: RakazoDesktopUpdate;
  /** Present only in the local-first window; main-process IPC validates the sender. */
  local?: RakazoDesktopLocal;
  oauth: {
    /**
     * Open system-browser auth. A redirect_uri must be HTTP loopback with state;
     * URLs without a redirect use backend polling. Optional for older desktops.
     */
    open?: (authorizationUrl: string) => Promise<void>;
    cancel?: (authorizationUrl: string) => Promise<void>;
    /**
     * Authorization codes captured from the system browser or a legacy popup.
     * Returns an unsubscribe function.
     */
    onCallback: (listener: (callback: RakazoDesktopOAuthCallback) => void) => () => void;
  };
}

/**
 * How the desktop app was pointed at a Rakazo server during first-run setup.
 * `new` is the Docker Compose stack this app installs and runs on the same computer.
 */
export type DesktopInstanceMode = "new" | "existing";

export interface DesktopSetup {
  mode: DesktopInstanceMode;
  serverUrl: string;
}

export interface DesktopSetupState {
  defaultLocalUrl: string;
  saved: DesktopSetup | null;
  /** Present when a saved or newly selected server could not be reopened. */
  error?: string;
}

export interface DesktopReachability {
  ok: boolean;
  /** HTTP status when the server answered, absent when it could not be reached. */
  status?: number;
  /** Normalized URL that was probed, absent when the input was not a usable URL. */
  url?: string;
  error?: string;
}

export interface DesktopStackProbeResponse {
  ok: true;
  imageTag: string;
}

/**
 * Lifecycle of the Docker Compose stack the desktop app manages for mode `new`.
 * `docker-missing` and `docker-not-running` wait for the person to act; `ready` and
 * `failed` are terminal until the next start.
 */
export type DesktopLocalStackPhase =
  | "idle"
  | "checking-docker"
  | "docker-missing"
  | "docker-not-running"
  | "preparing"
  | "pulling"
  | "starting"
  | "waiting-healthy"
  | "ready"
  | "failed";

export interface DesktopLocalStackState {
  phase: DesktopLocalStackPhase;
  /** One actionable sentence; null while the stack is progressing normally. */
  message: string | null;
  /** Bounded tail of docker output for the current attempt. */
  output: string[];
  /** Bytes pulled per image layer in the current attempt; the sum is the only progress Docker reports. */
  layerBytes: Record<string, number>;
  /** Image tag this app launches (`v<app version>` for installed builds, `edge` otherwise). */
  imageTag: string;
}

export type DesktopSetupLink = "docker-desktop" | "orbstack" | "docker-engine";

/**
 * Bridge exposed only to the first-run setup window. The app window keeps the
 * narrower `rakazoDesktop` bridge so a connected server can never re-point the app.
 */
export interface RakazoSetup {
  /** Used only to reserve space for native window controls in the local setup UI. */
  platform: string;
  state: () => Promise<DesktopSetupState>;
  test: (url: string) => Promise<DesktopReachability>;
  save: (setup: DesktopSetup) => Promise<{ ok: boolean; error?: string }>;
  quit: () => Promise<void>;
  /** Opens one of the Docker install pages in the system browser. */
  openLink: (link: DesktopSetupLink) => Promise<void>;
  /** The Docker Compose stack this app installs and runs for mode `new`. */
  stack: {
    state: () => Promise<DesktopLocalStackState>;
    /** Starts (or retries) the stack; a no-op while a start is already in flight. */
    start: () => Promise<DesktopLocalStackState>;
    /** Fires on every state change so progress never depends on a renderer timer. */
    onChange: (listener: (state: DesktopLocalStackState) => void) => void;
  };
}
