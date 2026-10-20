import type { DesktopBrowserBridgeStatus, DesktopLocalRunStarted } from "@rakazo/contracts";
import { GROK_COLOR_LIST } from "@rakazo/core";
import { BotAvatar, Button, Skeleton } from "@rakazo/ui-web";
import { AlertTriangle, Bot, Globe2, LogOut, Plus, Settings, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LocalAuthScreen } from "./LocalAuthScreen";
import { LocalComposer } from "./LocalComposer";
import { LocalLiveMessage, LocalMessageView } from "./LocalMessageView";
import { LocalSettingsDialog } from "./LocalSettings";
import {
  type LocalBot,
  type LocalBridge,
  type LocalMessage,
  type LocalRunEvent,
  type LocalSettings,
  localErrorMessage,
} from "./types";

const DEFAULT_SETTINGS: LocalSettings = {
  theme: "system",
  sendWithEnter: true,
  defaultModelId: null,
};

type UiError = {
  title: string;
  message: string;
  retry?: () => void;
};

function presentError(message: string): Pick<UiError, "title" | "message"> {
  const normalized = message.toLocaleLowerCase();
  if (normalized.includes("session") || normalized.includes("sign in")) {
    return { title: "Session expired", message };
  }
  if (normalized.includes("quota")) return { title: "Model quota exhausted", message };
  if (normalized.includes("busy") || normalized.includes("rate limit")) {
    return { title: "Model service is busy", message };
  }
  if (normalized.includes("reach") || normalized.includes("connection")) {
    return { title: "Connection problem", message };
  }
  return { title: "Could not complete the request", message };
}

function toolActivity(name: string | undefined): string {
  switch (name) {
    case "shell":
      return "Running a local command";
    case "list_files":
      return "Listing local files";
    case "read_file":
      return "Reading a local file";
    case "write_file":
      return "Writing a local file";
    case "browser_open":
    case "browser_navigate":
      return "Opening a browser page";
    case "browser_observe":
      return "Reading the browser page";
    case "browser_click":
      return "Clicking in the browser";
    case "browser_type":
      return "Typing in the browser";
    case "browser_scroll":
      return "Scrolling the browser page";
    case "browser_borrow_tab":
      return "Taking over an existing tab";
    default:
      return name ? `Using ${name}` : "Working";
  }
}

function WindowBar() {
  const desktop = window.rakazoDesktop;
  if (!desktop) return null;
  if (desktop.platform === "darwin") {
    return <div className="app-drag h-7 shrink-0" aria-hidden="true" />;
  }
  return (
    <div className="app-drag flex h-8 shrink-0 items-center gap-2 px-3">
      <button
        type="button"
        aria-label="Close window"
        className="app-no-drag size-3 rounded-full bg-[#ff5f57]"
        onClick={() => void desktop.window.close()}
      />
      <button
        type="button"
        aria-label="Minimize window"
        className="app-no-drag size-3 rounded-full bg-[#febc2e]"
        onClick={() => void desktop.window.minimize()}
      />
      <button
        type="button"
        aria-label="Maximize window"
        className="app-no-drag size-3 rounded-full bg-[#28c840]"
        onClick={() => void desktop.window.toggleMaximize()}
      />
    </div>
  );
}

function ErrorBanner({ error, clear }: { error: UiError; clear: () => void }) {
  return (
    <div
      role="alert"
      className="mx-4 mb-2 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-3 sm:mx-6"
    >
      <AlertTriangle size={17} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">{error.title}</p>
        <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">{error.message}</p>
      </div>
      {error.retry ? (
        <Button type="button" size="xs" variant="secondary" onClick={error.retry}>
          Retry
        </Button>
      ) : null}
      <Button type="button" size="icon-xs" variant="ghost" aria-label="Dismiss" onClick={clear}>
        <X size={13} />
      </Button>
    </div>
  );
}

export function LocalApp({ bridge }: { bridge?: LocalBridge }) {
  const api = bridge ?? window.rakazoDesktop?.local;
  const [bootError, setBootError] = useState("");
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState<{
    signedIn: boolean;
    serverUrl: string | null;
  } | null>(null);
  const [bots, setBots] = useState<LocalBot[]>([]);
  const [activeBotId, setActiveBotId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [settings, setSettings] = useState<LocalSettings>(DEFAULT_SETTINGS);
  const [systemLight, setSystemLight] = useState(
    () => window.matchMedia("(prefers-color-scheme: light)").matches,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newBotName, setNewBotName] = useState("");
  const [creating, setCreating] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageReload, setMessageReload] = useState(0);
  const [error, setError] = useState<UiError | null>(null);
  const [running, setRunning] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [liveStatus, setLiveStatus] = useState("Thinking");
  const [pendingText, setPendingText] = useState("");
  const [browser, setBrowser] = useState<DesktopBrowserBridgeStatus | null>(null);
  const activeBotIdRef = useRef<string | null>(null);
  const activeRunId = useRef<string | null>(null);
  const stopped = useRef(false);
  const messageScroller = useRef<HTMLDivElement>(null);

  const activeBot = bots.find((bot) => bot.id === activeBotId) ?? null;

  useEffect(() => {
    activeBotIdRef.current = activeBotId;
  }, [activeBotId]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const update = () => setSystemLight(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const resolved =
      settings.theme === "system" ? (systemLight ? "light" : "dark") : settings.theme;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  }, [settings.theme, systemLight]);

  useEffect(() => {
    if (!api) {
      setBootError("The local desktop bridge is unavailable.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const status = await api.auth.status();
        if (cancelled) return;
        setAuth({ signedIn: status.signedIn, serverUrl: status.serverUrl });
        if (!status.serverUrl || status.signedIn) await loadWorkspace();
      } catch (cause) {
        if (!cancelled) setBootError(localErrorMessage(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (!api || !activeBotId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoadingMessages(true);
    setError(null);
    void api.messages
      .list(activeBotId)
      .then((next) => {
        if (!cancelled && activeBotIdRef.current === activeBotId) setMessages(next);
      })
      .catch((cause) => {
        if (cancelled) return;
        const next = presentError(localErrorMessage(cause));
        setError({
          ...next,
          retry: () => setMessageReload((value) => value + 1),
        });
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeBotId, api, messageReload]);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const refresh = async () => {
      const next = await api.browser.status().catch(() => null);
      if (!cancelled) setBrowser(next);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api]);

  useEffect(() => {
    if (!api) return;
    const stopStart = api.runs.onStarted((run: DesktopLocalRunStarted) => {
      activeRunId.current = run.runId;
      setRunning(true);
      setLiveText("");
      setLiveStatus("Thinking");
    });
    const stopEvent = api.runs.onEvent(({ runId, event }) => {
      if (activeRunId.current !== runId) return;
      const localEvent = event as LocalRunEvent["event"];
      if (localEvent.type === "text" && typeof localEvent.text === "string") {
        setLiveText((current) => current + localEvent.text);
        setLiveStatus("");
      } else if (localEvent.type === "progress" && typeof localEvent.text === "string") {
        setLiveStatus(localEvent.text);
      } else if (localEvent.type === "tool") {
        setLiveStatus(toolActivity(localEvent.name));
      } else if (localEvent.type === "ask" && typeof localEvent.text === "string") {
        setLiveStatus(localEvent.text);
      }
    });
    return () => {
      stopStart();
      stopEvent();
    };
  }, [api]);

  useEffect(() => {
    const scroller = messageScroller.current;
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [liveText, liveStatus, messages, pendingText, running]);

  async function loadWorkspace() {
    if (!api) return;
    const [nextSettings, listedBots] = await Promise.all([api.settings.get(), api.bots.list()]);
    let nextBots = listedBots;
    if (nextBots.length === 0) {
      const created = await api.bots.create({
        name: "Assistant",
        description: "A local assistant with access to approved tools.",
        color: "blue",
      });
      nextBots = [created];
    }
    setSettings(nextSettings);
    setBots(nextBots);
    setActiveBotId((current) =>
      current && nextBots.some((bot) => bot.id === current) ? current : nextBots[0]!.id,
    );
  }

  async function afterSignIn() {
    if (!api) return;
    setLoading(true);
    try {
      setAuth(await api.auth.status());
      await loadWorkspace();
    } finally {
      setLoading(false);
    }
  }

  async function sendText(text: string): Promise<boolean> {
    if (!api || !activeBotId) return false;
    stopped.current = false;
    setError(null);
    setPendingText(text);
    setRunning(true);
    setLiveText("");
    setLiveStatus("Thinking");
    try {
      await api.messages.send(activeBotId, text);
      const next = await api.messages.list(activeBotId);
      if (activeBotIdRef.current === activeBotId) setMessages(next);
      return true;
    } catch (cause) {
      const nextMessages = await api.messages.list(activeBotId).catch(() => null);
      if (nextMessages && activeBotIdRef.current === activeBotId) setMessages(nextMessages);
      if (!stopped.current) {
        const presented = presentError(localErrorMessage(cause));
        setError({
          ...presented,
          retry: () => void sendText(text),
        });
      }
      return false;
    } finally {
      activeRunId.current = null;
      setRunning(false);
      setPendingText("");
      setLiveText("");
      setLiveStatus("Thinking");
    }
  }

  async function stop() {
    if (!api || !activeRunId.current) return;
    stopped.current = true;
    setLiveStatus("Stopping");
    try {
      await api.runs.cancel(activeRunId.current);
    } catch (cause) {
      setError(presentError(localErrorMessage(cause)));
    }
  }

  async function createBot() {
    if (!api || !newBotName.trim() || creating) return;
    setCreating(true);
    try {
      const color = GROK_COLOR_LIST[bots.length % GROK_COLOR_LIST.length]?.id ?? "blue";
      const created = await api.bots.create({ name: newBotName.trim(), color });
      setBots((current) => [...current, created]);
      setNewBotName("");
      setActiveBotId(created.id);
    } catch (cause) {
      setError(presentError(localErrorMessage(cause)));
    } finally {
      setCreating(false);
    }
  }

  async function signOut() {
    if (!api || running) return;
    await api.auth.logout().catch(() => undefined);
    setAuth((current) => (current ? { ...current, signedIn: false } : current));
    setBots([]);
    setMessages([]);
    setActiveBotId(null);
  }

  if (loading && !auth) {
    return (
      <div className="flex h-full flex-col bg-background">
        <WindowBar />
        <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)]">
          <aside className="border-e border-border bg-sidebar p-4">
            <Skeleton className="h-8 w-28" />
            <div className="mt-8 space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </aside>
          <div className="grid place-items-center">
            <Skeleton className="h-8 w-44" />
          </div>
        </div>
      </div>
    );
  }

  if (bootError || !api) {
    return (
      <div className="flex h-full flex-col bg-background">
        <WindowBar />
        <main className="grid min-h-0 flex-1 place-items-center px-6 text-center">
          <div className="max-w-sm">
            <AlertTriangle className="mx-auto text-destructive" />
            <h1 className="mt-3 text-base font-medium">ericBot could not start</h1>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              {bootError || "The desktop bridge is unavailable."}
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (auth?.serverUrl && !auth.signedIn) {
    return (
      <div className="flex h-full flex-col bg-background">
        <WindowBar />
        <LocalAuthScreen api={api} serverUrl={auth.serverUrl} onSignedIn={afterSignIn} />
      </div>
    );
  }

  const optimisticMessage: LocalMessage | null =
    pendingText && activeBot
      ? {
          id: "local-optimistic",
          threadId: "",
          sequence: Number.MAX_SAFE_INTEGER,
          role: "user",
          blocks: [{ kind: "text", text: pendingText }],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      : null;

  return (
    <div className="flex h-full flex-col bg-background">
      <WindowBar />
      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-e border-border bg-sidebar">
          <div className="px-4 pb-3 pt-2">
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-xl bg-primary text-primary-foreground">
                <Bot size={17} strokeWidth={2} />
              </span>
              <div>
                <h1 className="text-[16px] font-semibold tracking-tight">ericBot</h1>
                <p className="text-[10.5px] text-muted-foreground">Local-first workspace</p>
              </div>
            </div>
          </div>

          <div className="px-3">
            <div className="flex gap-1.5 rounded-xl border border-border bg-background/40 p-1">
              <input
                value={newBotName}
                maxLength={120}
                placeholder="New bot"
                aria-label="New bot name"
                className="min-w-0 flex-1 bg-transparent px-2 text-[13px] outline-none placeholder:text-muted-foreground"
                onChange={(event) => setNewBotName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void createBot();
                  }
                }}
              />
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Create bot"
                disabled={!newBotName.trim() || creating}
                onClick={() => void createBot()}
              >
                <Plus size={13} />
              </Button>
            </div>
          </div>

          <nav
            className="rk-scroll mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3"
            aria-label="Bots"
          >
            {bots.map((bot) => (
              <button
                key={bot.id}
                type="button"
                aria-current={bot.id === activeBotId ? "page" : undefined}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 ${
                  bot.id === activeBotId
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/55"
                }`}
                onClick={() => {
                  setActiveBotId(bot.id);
                  setError(null);
                }}
              >
                <BotAvatar
                  color={bot.color}
                  identity={bot.id}
                  size={30}
                  status={running && bot.id === activeBotId ? "running" : undefined}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{bot.name}</span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">
                    {bot.description || "Local bot"}
                  </span>
                </span>
              </button>
            ))}
          </nav>

          <div className="border-t border-sidebar-border px-4 py-3">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Globe2 size={13} />
              <span
                className={`size-1.5 rounded-full ${browser?.connected ? "bg-success" : "bg-muted-foreground/40"}`}
              />
              {browser?.connected ? "Chrome connected" : "Chrome not connected"}
            </div>
            <p className="mt-2 text-[10.5px] leading-4 text-muted-foreground/75">
              Chats and bot settings stay on this device.
            </p>
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col">
          <header className="flex min-h-[74px] items-center justify-between gap-4 border-b border-border px-5 py-3">
            <div className="flex min-w-0 items-center gap-3">
              {activeBot ? (
                <BotAvatar
                  color={activeBot.color}
                  identity={activeBot.id}
                  size={38}
                  status={running ? "running" : undefined}
                />
              ) : null}
              <div className="min-w-0">
                <h2 className="truncate text-[18px] font-semibold tracking-tight">
                  {activeBot?.name ?? "Local chat"}
                </h2>
                <p className="truncate text-[11.5px] text-muted-foreground">
                  {running ? liveStatus || "Working" : activeBot?.description || "Local assistant"}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Settings"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings size={15} />
              </Button>
              {auth?.serverUrl ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Sign out"
                  disabled={running}
                  onClick={() => void signOut()}
                >
                  <LogOut size={15} />
                </Button>
              ) : null}
            </div>
          </header>

          <div ref={messageScroller} className="rk-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="mx-auto flex min-h-full w-full max-w-[900px] flex-col gap-5">
              {loadingMessages ? (
                <div className="space-y-4">
                  <Skeleton className="h-16 w-3/4" />
                  <Skeleton className="ms-auto h-12 w-1/2" />
                </div>
              ) : messages.length === 0 && !optimisticMessage && !running ? (
                <div className="m-auto max-w-md text-center">
                  {activeBot ? (
                    <BotAvatar
                      color={activeBot.color}
                      identity={activeBot.id}
                      size={62}
                      className="mx-auto"
                    />
                  ) : null}
                  <h2 className="mt-4 text-[22px] font-semibold tracking-tight">
                    Chat with {activeBot?.name ?? "your assistant"}
                  </h2>
                  <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
                    Ask a question, run a local tool, or work in your signed-in browser.
                  </p>
                </div>
              ) : (
                messages.map((message) =>
                  activeBot ? (
                    <LocalMessageView
                      key={message.id}
                      message={message}
                      bot={activeBot}
                      bots={bots}
                    />
                  ) : null,
                )
              )}
              {optimisticMessage && activeBot ? (
                <LocalMessageView message={optimisticMessage} bot={activeBot} bots={bots} />
              ) : null}
              {running && activeBot ? (
                <LocalLiveMessage bot={activeBot} text={liveText} status={liveStatus} />
              ) : null}
            </div>
          </div>

          {error ? <ErrorBanner error={error} clear={() => setError(null)} /> : null}
          {activeBot ? (
            <LocalComposer
              bots={bots}
              activeBotName={activeBot.name}
              running={running}
              enterToSend={settings.sendWithEnter}
              onSend={sendText}
              onStop={stop}
            />
          ) : null}
        </main>
      </div>

      {activeBot && settingsOpen ? (
        <LocalSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          api={api}
          bot={activeBot}
          settings={settings}
          onSaved={(nextSettings, nextBot) => {
            setSettings(nextSettings);
            if (nextBot) {
              setBots((current) => current.map((bot) => (bot.id === nextBot.id ? nextBot : bot)));
            }
          }}
        />
      ) : null}
    </div>
  );
}
