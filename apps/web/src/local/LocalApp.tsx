import type { DesktopBrowserBridgeStatus, DesktopLocalRunStarted } from "@rakazo/contracts";
import { GROK_COLOR_LIST } from "@rakazo/core";
import { BotAvatar, Button, GroupAvatar, Skeleton } from "@rakazo/ui-web";
import {
  AlertTriangle,
  Bot,
  Brain,
  CalendarClock,
  Clock3,
  Globe2,
  LogOut,
  Plus,
  Settings,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { readFileAsBase64 } from "../lib/pending-attachments";
import { LocalActivityDialog } from "./LocalActivityDialog";
import { LocalAuthScreen } from "./LocalAuthScreen";
import { type ComposerAttachment, LocalComposer } from "./LocalComposer";
import { LocalGroupDialog } from "./LocalGroupDialog";
import { LocalMemoryDialog } from "./LocalMemoryDialog";
import { LocalLiveMessage, LocalMessageView } from "./LocalMessageView";
import { LocalRoutinesDialog } from "./LocalRoutinesDialog";
import { LocalSettingsDialog } from "./LocalSettings";
import {
  type LocalBot,
  type LocalBridge,
  type LocalGroup,
  type LocalGroupMessage,
  type LocalMessage,
  type LocalRunEvent,
  type LocalSettings,
  localErrorMessage,
} from "./types";

type LocalTarget = { kind: "bot"; id: string } | { kind: "group"; id: string };

function targetKey(target: LocalTarget | null): string | null {
  return target ? `${target.kind}:${target.id}` : null;
}

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
    case "handoff_to_bot":
      return "Handing off to another bot";
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
  const [groups, setGroups] = useState<LocalGroup[]>([]);
  const [activeTarget, setActiveTarget] = useState<LocalTarget | null>(null);
  const [messages, setMessages] = useState<Array<LocalMessage | LocalGroupMessage>>([]);
  const [settings, setSettings] = useState<LocalSettings>(DEFAULT_SETTINGS);
  const [systemLight, setSystemLight] = useState(
    () => window.matchMedia("(prefers-color-scheme: light)").matches,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [routinesOpen, setRoutinesOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [newBotName, setNewBotName] = useState("");
  const [creating, setCreating] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageReload, setMessageReload] = useState(0);
  const [error, setError] = useState<UiError | null>(null);
  const [running, setRunning] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [liveStatus, setLiveStatus] = useState("Thinking");
  const [liveBotId, setLiveBotId] = useState<string | null>(null);
  const [pendingText, setPendingText] = useState("");
  const [browser, setBrowser] = useState<DesktopBrowserBridgeStatus | null>(null);
  const activeTargetRef = useRef<LocalTarget | null>(null);
  const activeRunId = useRef<string | null>(null);
  const stopped = useRef(false);
  const messageScroller = useRef<HTMLDivElement>(null);

  const activeBot =
    activeTarget?.kind === "bot" ? (bots.find((bot) => bot.id === activeTarget.id) ?? null) : null;
  const activeGroup =
    activeTarget?.kind === "group"
      ? (groups.find((group) => group.id === activeTarget.id) ?? null)
      : null;
  const editingGroup = editingGroupId
    ? (groups.find((group) => group.id === editingGroupId) ?? null)
    : null;
  const activeMembers = activeGroup?.members ?? bots;
  const activeName = activeGroup?.name ?? activeBot?.name ?? "chat";
  const liveBot = bots.find((bot) => bot.id === liveBotId) ?? null;

  useEffect(() => {
    activeTargetRef.current = activeTarget;
  }, [activeTarget]);

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
    if (!api || !activeTarget) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoadingMessages(true);
    setError(null);
    const expectedTarget = targetKey(activeTarget);
    const loading =
      activeTarget.kind === "bot"
        ? api.messages.list(activeTarget.id)
        : api.groups.messages.list(activeTarget.id);
    void loading
      .then((next) => {
        if (!cancelled && targetKey(activeTargetRef.current) === expectedTarget) {
          setMessages(next);
        }
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
  }, [activeTarget, api, messageReload]);

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
      setLiveBotId(run.botId);
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
    const [nextSettings, listedBots, listedGroups] = await Promise.all([
      api.settings.get(),
      api.bots.list(),
      api.groups.list(),
    ]);
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
    setGroups(listedGroups);
    setActiveTarget((current) => {
      if (current?.kind === "bot" && nextBots.some((bot) => bot.id === current.id)) {
        return current;
      }
      if (current?.kind === "group" && listedGroups.some((group) => group.id === current.id)) {
        return current;
      }
      if (nextBots[0]) return { kind: "bot", id: nextBots[0].id };
      if (listedGroups[0]) return { kind: "group", id: listedGroups[0].id };
      return null;
    });
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

  async function sendText(
    text: string,
    attachments: readonly ComposerAttachment[] = [],
  ): Promise<boolean> {
    if (!api || !activeTarget) return false;
    const target = activeTarget;
    const expectedTarget = targetKey(target);
    stopped.current = false;
    setError(null);
    setPendingText(text);
    try {
      const artifactIds: string[] = [];
      for (const attachment of attachments) {
        const artifact = await api.artifacts.create({
          ...(target.kind === "bot" ? { botId: target.id } : { groupId: target.id }),
          name: attachment.file.name,
          mimeType: attachment.mimeType,
          contentBase64: await readFileAsBase64(attachment.file),
        });
        artifactIds.push(artifact.id);
      }
      setRunning(true);
      setLiveBotId(target.kind === "bot" ? target.id : null);
      setLiveText("");
      setLiveStatus("Thinking");
      if (target.kind === "bot") await api.messages.send(target.id, text, artifactIds);
      else await api.groups.messages.send(target.id, text, artifactIds);
      const next =
        target.kind === "bot"
          ? await api.messages.list(target.id)
          : await api.groups.messages.list(target.id);
      if (targetKey(activeTargetRef.current) === expectedTarget) setMessages(next);
      return true;
    } catch (cause) {
      const nextMessages = await (target.kind === "bot"
        ? api.messages.list(target.id)
        : api.groups.messages.list(target.id)
      ).catch(() => null);
      if (nextMessages && targetKey(activeTargetRef.current) === expectedTarget) {
        setMessages(nextMessages);
      }
      if (!stopped.current) {
        const presented = presentError(localErrorMessage(cause));
        setError({
          ...presented,
          retry: () => void sendText(text, attachments),
        });
      }
      return false;
    } finally {
      activeRunId.current = null;
      setLiveBotId(null);
      setRunning(false);
      setPendingText("");
      setLiveText("");
      setLiveStatus("Thinking");
    }
  }

  async function stop() {
    if (!api || !activeTarget) return;
    stopped.current = true;
    setLiveStatus("Stopping");
    try {
      if (activeTarget.kind === "group") await api.groups.cancel(activeTarget.id);
      else if (activeRunId.current) await api.runs.cancel(activeRunId.current);
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
      setActiveTarget({ kind: "bot", id: created.id });
    } catch (cause) {
      setError(presentError(localErrorMessage(cause)));
    } finally {
      setCreating(false);
    }
  }

  function handleGroupSaved(group: LocalGroup) {
    setGroups((current) => {
      const existing = current.some((item) => item.id === group.id);
      return existing
        ? current.map((item) => (item.id === group.id ? group : item))
        : [group, ...current];
    });
    setActiveTarget({ kind: "group", id: group.id });
    setEditingGroupId(null);
  }

  function handleGroupDeleted(groupId: string) {
    setGroups((current) => current.filter((group) => group.id !== groupId));
    if (activeTarget?.kind === "group" && activeTarget.id === groupId) {
      setActiveTarget(bots[0] ? { kind: "bot", id: bots[0].id } : null);
    }
  }

  async function signOut() {
    if (!api || running) return;
    await api.auth.logout().catch(() => undefined);
    setAuth((current) => (current ? { ...current, signedIn: false } : current));
    setBots([]);
    setGroups([]);
    setMessages([]);
    setActiveTarget(null);
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

  const optimisticMessage: LocalMessage | LocalGroupMessage | null =
    pendingText && activeTarget
      ? {
          id: "local-optimistic",
          threadId: "",
          sequence: Number.MAX_SAFE_INTEGER,
          role: "user",
          ...(activeTarget.kind === "group" ? { botId: null } : {}),
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
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1.5 w-full justify-start text-muted-foreground"
              disabled={bots.length < 2}
              title={bots.length < 2 ? "Create at least two bots first" : undefined}
              onClick={() => {
                setEditingGroupId(null);
                setGroupDialogOpen(true);
              }}
            >
              <Users size={13} />
              New group
            </Button>
          </div>

          <nav
            className="rk-scroll mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3"
            aria-label="Bots"
          >
            {groups.length > 0 ? (
              <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Groups
              </p>
            ) : null}
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                aria-current={
                  activeTarget?.kind === "group" && activeTarget.id === group.id
                    ? "page"
                    : undefined
                }
                className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 ${
                  activeTarget?.kind === "group" && activeTarget.id === group.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/55"
                }`}
                onClick={() => {
                  setActiveTarget({ kind: "group", id: group.id });
                  setError(null);
                }}
              >
                <GroupAvatar
                  members={group.members.map((member) => ({
                    name: member.name,
                    color: member.color,
                    botId: member.id,
                  }))}
                  size={30}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{group.name}</span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">
                    {group.members.length} bots
                  </span>
                </span>
              </button>
            ))}
            <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Chats
            </p>
            {bots.map((bot) => (
              <button
                key={bot.id}
                type="button"
                aria-current={
                  activeTarget?.kind === "bot" && activeTarget.id === bot.id ? "page" : undefined
                }
                className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 ${
                  activeTarget?.kind === "bot" && activeTarget.id === bot.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/55"
                }`}
                onClick={() => {
                  setActiveTarget({ kind: "bot", id: bot.id });
                  setError(null);
                }}
              >
                <BotAvatar
                  color={bot.color}
                  identity={bot.id}
                  size={30}
                  status={running && bot.id === liveBotId ? "running" : undefined}
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
              {activeGroup ? (
                <GroupAvatar
                  members={activeGroup.members.map((member) => ({
                    name: member.name,
                    color: member.color,
                    botId: member.id,
                    status: running && member.id === liveBotId ? "running" : undefined,
                  }))}
                  size={38}
                />
              ) : activeBot ? (
                <BotAvatar
                  color={activeBot.color}
                  identity={activeBot.id}
                  size={38}
                  status={running ? "running" : undefined}
                />
              ) : null}
              <div className="min-w-0">
                <h2 className="truncate text-[18px] font-semibold tracking-tight">{activeName}</h2>
                <p className="truncate text-[11.5px] text-muted-foreground">
                  {running
                    ? liveStatus || "Working"
                    : activeGroup
                      ? `${activeGroup.members.length} bots · Shared group thread`
                      : activeBot?.description || "Local assistant"}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {activeBot ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Routines"
                    onClick={() => setRoutinesOpen(true)}
                  >
                    <CalendarClock size={15} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Memory"
                    onClick={() => setMemoryOpen(true)}
                  >
                    <Brain size={15} />
                  </Button>
                </>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Activity"
                onClick={() => setActivityOpen(true)}
              >
                <Clock3 size={15} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Settings"
                onClick={() => {
                  if (activeGroup) {
                    setEditingGroupId(activeGroup.id);
                    setGroupDialogOpen(true);
                  } else {
                    setSettingsOpen(true);
                  }
                }}
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
                  {activeGroup ? (
                    <GroupAvatar
                      members={activeGroup.members.map((member) => ({
                        name: member.name,
                        color: member.color,
                        botId: member.id,
                      }))}
                      size={62}
                      className="mx-auto"
                    />
                  ) : activeBot ? (
                    <BotAvatar
                      color={activeBot.color}
                      identity={activeBot.id}
                      size={62}
                      className="mx-auto"
                    />
                  ) : null}
                  <h2 className="mt-4 text-[22px] font-semibold tracking-tight">
                    {activeGroup
                      ? `Start ${activeGroup.name}`
                      : `Chat with ${activeBot?.name ?? "your assistant"}`}
                  </h2>
                  <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
                    {activeGroup
                      ? "Mention one or several members, or send a message to wake the first bot."
                      : "Ask a question, run a local tool, or work in your signed-in browser."}
                  </p>
                </div>
              ) : (
                messages.map((message) => {
                  const botId = "botId" in message ? message.botId : (activeBot?.id ?? null);
                  return (
                    <LocalMessageView
                      key={message.id}
                      message={message}
                      bot={bots.find((bot) => bot.id === botId)}
                      bots={activeMembers}
                      api={api}
                    />
                  );
                })
              )}
              {optimisticMessage ? (
                <LocalMessageView
                  message={optimisticMessage}
                  bot={activeBot ?? undefined}
                  bots={activeMembers}
                  api={api}
                />
              ) : null}
              {running ? (
                <LocalLiveMessage bot={liveBot ?? undefined} text={liveText} status={liveStatus} />
              ) : null}
            </div>
          </div>

          {error ? <ErrorBanner error={error} clear={() => setError(null)} /> : null}
          {activeTarget ? (
            <LocalComposer
              bots={activeMembers}
              activeBotName={activeName}
              includeEveryone={Boolean(activeGroup)}
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
      <LocalGroupDialog
        open={groupDialogOpen}
        onOpenChange={(next) => {
          setGroupDialogOpen(next);
          if (!next) setEditingGroupId(null);
        }}
        api={api}
        bots={bots}
        group={editingGroup ?? undefined}
        onSaved={handleGroupSaved}
        onDeleted={handleGroupDeleted}
      />
      <LocalActivityDialog
        open={activityOpen}
        onOpenChange={setActivityOpen}
        api={api}
        botName={(botId) => bots.find((bot) => bot.id === botId)?.name ?? "Bot"}
        groupName={(groupId) =>
          groupId ? groups.find((group) => group.id === groupId)?.name : undefined
        }
      />
      {activeBot ? (
        <>
          <LocalMemoryDialog
            open={memoryOpen}
            onOpenChange={setMemoryOpen}
            api={api}
            bot={activeBot}
          />
          <LocalRoutinesDialog
            open={routinesOpen}
            onOpenChange={setRoutinesOpen}
            api={api}
            bot={activeBot}
          />
        </>
      ) : null}
    </div>
  );
}
