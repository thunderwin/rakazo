import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type {
  DesktopBrowserBridgeStatus,
  DesktopLocalChoiceRequest,
  DesktopLocalRunStarted,
  DesktopLocalSecretRequest,
  DesktopManagedManifestState,
} from "@rakazo/contracts";
import { GROK_COLOR_LIST } from "@rakazo/core";
import {
  BotAvatar,
  Button,
  GroupAvatar,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
} from "@rakazo/ui-web";
import {
  AlertTriangle,
  Archive,
  Bot,
  Brain,
  CalendarClock,
  Clock3,
  Globe2,
  LogOut,
  Plus,
  Settings,
  SlidersHorizontal,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { i18n } from "../lib/i18n";
import { readFileAsBase64 } from "../lib/pending-attachments";
import {
  CommandPalette,
  isCommandPaletteHotkey,
} from "../pages/shell/command-palette";
import { LocalActivityDialog } from "./LocalActivityDialog";
import { LocalAppSettingsDialog } from "./LocalAppSettings";
import { LocalArchivedBotsDialog } from "./LocalArchivedBotsDialog";
import { LocalAuthScreen } from "./LocalAuthScreen";
import { LocalBotSettingsDialog } from "./LocalBotSettings";
import { LocalChoicePromptDialog } from "./LocalChoicePromptDialog";
import { type ComposerAttachment, LocalComposer } from "./LocalComposer";
import { LocalGroupDialog } from "./LocalGroupDialog";
import { LocalKnowledgeSkillsDialog } from "./LocalKnowledgeSkillsDialog";
import { LocalMemoryDialog } from "./LocalMemoryDialog";
import { LocalLiveMessage, LocalMessageView } from "./LocalMessageView";
import { LocalRoutinesDialog } from "./LocalRoutinesDialog";
import {
  LocalSecretPromptDialog,
  LocalSecretsDialog,
} from "./LocalSecretsDialog";
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

function sectionKey(item: {
  pinned?: boolean;
  section?: string | null;
}): string {
  if (item.pinned) return "pinned";
  return item.section?.trim() || "default";
}

function orderedBySection<
  T extends { pinned?: boolean; section?: string | null; name: string },
>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => {
    const leftSection = sectionKey(left);
    const rightSection = sectionKey(right);
    if (leftSection === "pinned" && rightSection !== "pinned") return -1;
    if (rightSection === "pinned" && leftSection !== "pinned") return 1;
    if (leftSection === "default" && rightSection !== "default") return 1;
    if (rightSection === "default" && leftSection !== "default") return -1;
    return (
      leftSection.localeCompare(rightSection) ||
      left.name.localeCompare(right.name)
    );
  });
}

function targetKey(target: LocalTarget | null): string | null {
  return target ? `${target.kind}:${target.id}` : null;
}

const DEFAULT_SETTINGS: LocalSettings = {
  theme: "light",
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
  if (
    normalized.includes("session") ||
    normalized.includes("sign in") ||
    normalized.includes("登录") ||
    normalized.includes("会话")
  ) {
    return { title: i18n._(msg`Session expired`), message };
  }
  if (normalized.includes("quota") || normalized.includes("额度")) {
    return { title: i18n._(msg`Model quota exhausted`), message };
  }
  if (
    normalized.includes("busy") ||
    normalized.includes("rate limit") ||
    normalized.includes("繁忙")
  ) {
    return { title: i18n._(msg`Model service is busy`), message };
  }
  if (
    normalized.includes("reach") ||
    normalized.includes("connection") ||
    normalized.includes("model gateway") ||
    normalized.includes("模型网关") ||
    normalized.includes("连接")
  ) {
    return { title: i18n._(msg`Connection problem`), message };
  }
  return { title: i18n._(msg`Could not complete the request`), message };
}

function toolActivity(name: string | undefined): string {
  switch (name) {
    case "shell":
      return i18n._(msg`Running a local command`);
    case "list_files":
      return i18n._(msg`Listing local files`);
    case "read_file":
      return i18n._(msg`Reading a local file`);
    case "write_file":
      return i18n._(msg`Writing a local file`);
    case "browser_open":
    case "browser_navigate":
      return i18n._(msg`Opening a browser page`);
    case "browser_observe":
      return i18n._(msg`Reading the browser page`);
    case "browser_click":
      return i18n._(msg`Clicking in the browser`);
    case "browser_type":
      return i18n._(msg`Typing in the browser`);
    case "browser_scroll":
      return i18n._(msg`Scrolling the browser page`);
    case "browser_borrow_tab":
      return i18n._(msg`Taking over an existing tab`);
    case "handoff_to_bot":
      return i18n._(msg`Handing off to another bot`);
    default:
      return name ? i18n._(msg`Using ${name}`) : i18n._(msg`Working`);
  }
}

function WindowBar() {
  const { t } = useLingui();
  const desktop = window.rakazoDesktop;
  if (!desktop) return null;
  if (desktop.platform === "darwin") {
    return <div className="app-drag h-7 shrink-0" aria-hidden="true" />;
  }
  return (
    <div className="app-drag flex h-8 shrink-0 items-center gap-2 px-3">
      <button
        type="button"
        aria-label={t`Close window`}
        className="app-no-drag size-3 rounded-full bg-[#ff5f57]"
        onClick={() => void desktop.window.close()}
      />
      <button
        type="button"
        aria-label={t`Minimize window`}
        className="app-no-drag size-3 rounded-full bg-[#febc2e]"
        onClick={() => void desktop.window.minimize()}
      />
      <button
        type="button"
        aria-label={t`Maximize window`}
        className="app-no-drag size-3 rounded-full bg-[#28c840]"
        onClick={() => void desktop.window.toggleMaximize()}
      />
    </div>
  );
}

function ErrorBanner({ error, clear }: { error: UiError; clear: () => void }) {
  const { t } = useLingui();
  return (
    <div
      role="alert"
      className="mx-4 mb-2 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-3 sm:mx-6"
    >
      <AlertTriangle
        size={17}
        className="mt-0.5 shrink-0 text-destructive"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">{error.title}</p>
        <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">
          {error.message}
        </p>
      </div>
      {error.retry ? (
        <Button
          type="button"
          size="xs"
          variant="secondary"
          onClick={error.retry}
        >
          <Trans>Retry</Trans>
        </Button>
      ) : null}
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label={t`Dismiss`}
        onClick={clear}
      >
        <X size={13} />
      </Button>
    </div>
  );
}

function LocalAppContent({ bridge }: { bridge?: LocalBridge }) {
  const { t } = useLingui();
  const api = bridge ?? window.rakazoDesktop?.local;
  const [bootError, setBootError] = useState("");
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState<Awaited<
    ReturnType<LocalBridge["auth"]["status"]>
  > | null>(null);
  const [bots, setBots] = useState<LocalBot[]>([]);
  const [groups, setGroups] = useState<LocalGroup[]>([]);
  const [activeTarget, setActiveTarget] = useState<LocalTarget | null>(null);
  const [messages, setMessages] = useState<
    Array<LocalMessage | LocalGroupMessage>
  >([]);
  const [settings, setSettings] = useState<LocalSettings>(DEFAULT_SETTINGS);
  const [systemLight, setSystemLight] = useState(
    () => window.matchMedia("(prefers-color-scheme: light)").matches,
  );
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [botSettingsOpen, setBotSettingsOpen] = useState(false);
  const [secretsOpen, setSecretsOpen] = useState(false);
  const [archivedBotsOpen, setArchivedBotsOpen] = useState(false);
  const [secretRequest, setSecretRequest] =
    useState<DesktopLocalSecretRequest | null>(null);
  const [choiceRequest, setChoiceRequest] =
    useState<DesktopLocalChoiceRequest | null>(null);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryScope, setMemoryScope] = useState<"bot" | "user">("bot");
  const [routinesOpen, setRoutinesOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [newBotName, setNewBotName] = useState("");
  const [creating, setCreating] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageReload, setMessageReload] = useState(0);
  const [error, setError] = useState<UiError | null>(null);
  const [running, setRunning] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [liveStatus, setLiveStatus] = useState(() => t`Thinking…`);
  const [liveBotId, setLiveBotId] = useState<string | null>(null);
  const [pendingText, setPendingText] = useState("");
  const [browser, setBrowser] = useState<DesktopBrowserBridgeStatus | null>(
    null,
  );
  const [managedManifest, setManagedManifest] =
    useState<DesktopManagedManifestState | null>(null);
  const activeTargetRef = useRef<LocalTarget | null>(null);
  const activeRunId = useRef<string | null>(null);
  const stopped = useRef(false);
  const messageScroller = useRef<HTMLDivElement>(null);

  const activeBot =
    activeTarget?.kind === "bot"
      ? (bots.find((bot) => bot.id === activeTarget.id) ?? null)
      : null;
  const activeGroup =
    activeTarget?.kind === "group"
      ? (groups.find((group) => group.id === activeTarget.id) ?? null)
      : null;
  const orderedGroups = orderedBySection(groups);
  const orderedBots = orderedBySection(bots);
  const editingGroup = editingGroupId
    ? (groups.find((group) => group.id === editingGroupId) ?? null)
    : null;
  const activeMembers = activeGroup?.members ?? bots;
  const activeName = activeGroup?.name ?? activeBot?.name ?? t`chat`;
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
      settings.theme === "system"
        ? systemLight
          ? "light"
          : "dark"
        : settings.theme;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  }, [settings.theme, systemLight]);

  useEffect(() => {
    if (!api) {
      setBootError(t`The local desktop bridge is unavailable.`);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const status = await api.auth.status();
        if (cancelled) return;
        setAuth(status);
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
  }, [api, t]);

  useEffect(() => {
    if (!api) return;
    return api.secrets.onRequest(setSecretRequest);
  }, [api]);

  useEffect(() => {
    if (!api) return;
    return api.prompts.onChoiceRequest(setChoiceRequest);
  }, [api]);

  useEffect(() => {
    if (!api) return;
    let active = true;
    void api.manifest
      .state()
      .then((state) => {
        if (active) setManagedManifest(state);
      })
      .catch(() => undefined);
    const stop = api.manifest.onUpdated((state) => {
      setManagedManifest(state);
      void loadWorkspace().catch((cause) => {
        setError(presentError(localErrorMessage(cause)));
      });
    });
    return () => {
      active = false;
      stop();
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
        if (
          !cancelled &&
          targetKey(activeTargetRef.current) === expectedTarget
        ) {
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
      setLiveStatus(t`Thinking…`);
    });
    const stopEvent = api.runs.onEvent(({ runId, event }) => {
      if (activeRunId.current !== runId) return;
      const localEvent = event as LocalRunEvent["event"];
      if (localEvent.type === "text" && typeof localEvent.text === "string") {
        setLiveText((current) => current + localEvent.text);
        setLiveStatus("");
      } else if (
        localEvent.type === "progress" &&
        typeof localEvent.text === "string"
      ) {
        setLiveStatus(localEvent.text);
      } else if (localEvent.type === "tool") {
        setLiveStatus(toolActivity(localEvent.name));
      } else if (
        localEvent.type === "ask" &&
        typeof localEvent.text === "string"
      ) {
        setLiveStatus(localEvent.text);
      } else if (
        localEvent.type === "message" &&
        typeof localEvent.text === "string"
      ) {
        setLiveStatus(localEvent.text);
      }
    });
    return () => {
      stopStart();
      stopEvent();
    };
  }, [api, t]);

  useEffect(() => {
    const scroller = messageScroller.current;
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [liveText, liveStatus, messages, pendingText, running]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!isCommandPaletteHotkey(event)) return;
      event.preventDefault();
      setCommandPaletteOpen((open) => !open);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
        name: t`Assistant`,
        description: t`A local assistant with access to approved tools.`,
        color: "blue",
      });
      nextBots = [created];
    }
    setSettings(nextSettings);
    setBots(nextBots);
    setGroups(listedGroups);
    setActiveTarget((current) => {
      if (
        current?.kind === "bot" &&
        nextBots.some((bot) => bot.id === current.id)
      ) {
        return current;
      }
      if (
        current?.kind === "group" &&
        listedGroups.some((group) => group.id === current.id)
      ) {
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
          ...(target.kind === "bot"
            ? { botId: target.id }
            : { groupId: target.id }),
          name: attachment.file.name,
          mimeType: attachment.mimeType,
          contentBase64: await readFileAsBase64(attachment.file),
        });
        artifactIds.push(artifact.id);
      }
      setRunning(true);
      setLiveBotId(target.kind === "bot" ? target.id : null);
      setLiveText("");
      setLiveStatus(t`Thinking…`);
      if (target.kind === "bot") {
        await api.messages.send(target.id, text, artifactIds);
        await loadWorkspace();
      } else {
        await api.groups.messages.send(target.id, text, artifactIds);
      }
      const next =
        target.kind === "bot"
          ? await api.messages.list(target.id)
          : await api.groups.messages.list(target.id);
      if (targetKey(activeTargetRef.current) === expectedTarget)
        setMessages(next);
      return true;
    } catch (cause) {
      const nextMessages = await (
        target.kind === "bot"
          ? api.messages.list(target.id)
          : api.groups.messages.list(target.id)
      ).catch(() => null);
      if (
        nextMessages &&
        targetKey(activeTargetRef.current) === expectedTarget
      ) {
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
      setLiveStatus(t`Thinking…`);
    }
  }

  async function stop() {
    if (!api || !activeTarget) return;
    stopped.current = true;
    setLiveStatus(t`Stopping…`);
    try {
      if (activeTarget.kind === "group")
        await api.groups.cancel(activeTarget.id);
      else if (activeRunId.current) await api.runs.cancel(activeRunId.current);
    } catch (cause) {
      setError(presentError(localErrorMessage(cause)));
    }
  }

  async function createBot() {
    if (!api || !newBotName.trim() || creating) return;
    setCreating(true);
    try {
      const color =
        GROK_COLOR_LIST[bots.length % GROK_COLOR_LIST.length]?.id ?? "blue";
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
    setAccountMenuOpen(false);
    setAppSettingsOpen(false);
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
            <h1 className="mt-3 text-base font-medium">
              <Trans>ericBot could not start</Trans>
            </h1>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              {bootError || t`The desktop bridge is unavailable.`}
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
        <LocalAuthScreen
          api={api}
          serverUrl={auth.serverUrl}
          onSignedIn={afterSignIn}
        />
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
                <h1 className="text-[16px] font-semibold tracking-tight">
                  ericBot
                </h1>
                <p className="text-[10.5px] text-muted-foreground">
                  <Trans>Local-first workspace</Trans>
                </p>
              </div>
            </div>
          </div>

          <div className="px-3">
            <div className="flex gap-1.5 rounded-xl border border-border bg-background/40 p-1">
              <input
                value={newBotName}
                maxLength={120}
                placeholder={t`New bot`}
                aria-label={t`New bot name`}
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
                aria-label={t`Create bot`}
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
              title={
                bots.length < 2 ? t`Create at least two bots first` : undefined
              }
              onClick={() => {
                setEditingGroupId(null);
                setGroupDialogOpen(true);
              }}
            >
              <Users size={13} />
              <Trans>New group</Trans>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1 w-full justify-start text-muted-foreground"
              onClick={() => setArchivedBotsOpen(true)}
            >
              <Archive size={13} />
              <Trans>Archived bots</Trans>
            </Button>
          </div>

          <nav
            className="rk-scroll mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3"
            aria-label={t`Bots`}
          >
            {groups.length > 0 ? (
              <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                <Trans>Groups</Trans>
              </p>
            ) : null}
            {orderedGroups.map((group, index) => {
              const currentSection = sectionKey(group);
              const previousSection =
                index === 0 ? null : sectionKey(orderedGroups[index - 1]!);
              return (
                <Fragment key={group.id}>
                  {currentSection !== previousSection ? (
                    <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      {currentSection === "pinned"
                        ? t`Pinned`
                        : currentSection === "default"
                          ? t`Groups`
                          : group.section}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    aria-current={
                      activeTarget?.kind === "group" &&
                      activeTarget.id === group.id
                        ? "page"
                        : undefined
                    }
                    className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 ${
                      activeTarget?.kind === "group" &&
                      activeTarget.id === group.id
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
                      <span className="block truncate text-[13px] font-medium">
                        {group.name}
                      </span>
                      <span className="block truncate text-[10.5px] text-muted-foreground">
                        <Trans>{group.members.length} bots</Trans>
                      </span>
                    </span>
                  </button>
                </Fragment>
              );
            })}
            {orderedBots.map((bot, index) => {
              const currentSection = sectionKey(bot);
              const previousSection =
                index === 0 ? null : sectionKey(orderedBots[index - 1]!);
              return (
                <Fragment key={bot.id}>
                  {currentSection !== previousSection ? (
                    <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      {currentSection === "pinned"
                        ? t`Pinned`
                        : currentSection === "default"
                          ? t`Chats`
                          : bot.section}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    aria-current={
                      activeTarget?.kind === "bot" && activeTarget.id === bot.id
                        ? "page"
                        : undefined
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
                      status={
                        running && bot.id === liveBotId ? "running" : undefined
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">
                        {bot.name}
                      </span>
                      <span className="block truncate text-[10.5px] text-muted-foreground">
                        {bot.description || t`Local bot`}
                      </span>
                    </span>
                  </button>
                </Fragment>
              );
            })}
          </nav>

          <div className="border-t border-sidebar-border px-4 py-3">
            <Popover open={accountMenuOpen} onOpenChange={setAccountMenuOpen}>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    className="mb-2 h-auto w-full justify-start gap-2.5 px-2 py-2 text-start"
                    aria-label={t`Account`}
                  />
                }
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                  <UserRound size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-foreground">
                    {auth?.name || auth?.email || t`Account`}
                  </span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">
                    {auth?.email || auth?.serverUrl || t`Local-first workspace`}
                  </span>
                </span>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-[260px]">
                <div className="border-b border-border px-1 pb-2.5">
                  <p className="truncate text-[13px] font-medium">
                    {auth?.name || auth?.email || t`Account`}
                  </p>
                  {auth?.email ? (
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {auth.email}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full justify-start"
                  aria-label={t`Activity`}
                  onClick={() => {
                    setAccountMenuOpen(false);
                    setActivityOpen(true);
                  }}
                >
                  <Clock3 size={14} />
                  <Trans>Activity</Trans>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full justify-start"
                  aria-label={t`App settings`}
                  onClick={() => {
                    setAccountMenuOpen(false);
                    setAppSettingsOpen(true);
                  }}
                >
                  <SlidersHorizontal size={14} />
                  <Trans>App settings</Trans>
                </Button>
                {auth?.serverUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full justify-start"
                    aria-label={t`Sign out`}
                    disabled={running}
                    onClick={() => void signOut()}
                  >
                    <LogOut size={14} />
                    <Trans>Sign out</Trans>
                  </Button>
                ) : null}
              </PopoverContent>
            </Popover>
            {managedManifest ? (
              <p className="mb-2 truncate text-[10.5px] text-muted-foreground">
                <Trans>Managed by {managedManifest.organizationName}</Trans>
              </p>
            ) : null}
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Globe2 size={13} />
              <span
                className={`size-1.5 rounded-full ${browser?.connected ? "bg-success" : "bg-muted-foreground/40"}`}
              />
              {browser?.connected
                ? t`Chrome connected`
                : t`Chrome not connected`}
            </div>
            <p className="mt-2 text-[10.5px] leading-4 text-muted-foreground/75">
              <Trans>Chats and bot settings stay on this device.</Trans>
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
                    status:
                      running && member.id === liveBotId
                        ? "running"
                        : undefined,
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
                <h2 className="truncate text-[18px] font-semibold tracking-tight">
                  {activeName}
                </h2>
                <p className="truncate text-[11.5px] text-muted-foreground">
                  {running
                    ? liveStatus || t`Working`
                    : activeGroup
                      ? t`${activeGroup.members.length} bots · Shared group thread`
                      : activeBot?.description || t`Local assistant`}
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
                    aria-label={t`Routines`}
                    onClick={() => setRoutinesOpen(true)}
                  >
                    <CalendarClock size={15} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t`Memory`}
                    onClick={() => {
                      setMemoryScope("bot");
                      setMemoryOpen(true);
                    }}
                  >
                    <Brain size={15} />
                  </Button>
                </>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={activeGroup ? t`Group settings` : t`Chat settings`}
                title={activeGroup ? t`Group settings` : t`Chat settings`}
                onClick={() => {
                  if (activeGroup) {
                    setEditingGroupId(activeGroup.id);
                    setGroupDialogOpen(true);
                  } else {
                    setBotSettingsOpen(true);
                  }
                }}
              >
                <Settings size={15} />
              </Button>
            </div>
          </header>

          <div
            ref={messageScroller}
            className="rk-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5"
          >
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
                      ? t`Start ${activeGroup.name}`
                      : t`Chat with ${activeBot?.name ?? t`your assistant`}`}
                  </h2>
                  <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
                    {activeGroup
                      ? t`Mention one or several members, or send a message to wake the first bot.`
                      : t`Ask a question, run a local tool, or work in your signed-in browser.`}
                  </p>
                </div>
              ) : (
                messages.map((message) => {
                  const botId =
                    "botId" in message
                      ? message.botId
                      : (activeBot?.id ?? null);
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
                <LocalLiveMessage
                  bot={liveBot ?? undefined}
                  text={liveText}
                  status={liveStatus}
                />
              ) : null}
            </div>
          </div>

          {error ? (
            <ErrorBanner error={error} clear={() => setError(null)} />
          ) : null}
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

      {appSettingsOpen ? (
        <LocalAppSettingsDialog
          open={appSettingsOpen}
          onOpenChange={setAppSettingsOpen}
          api={api}
          settings={settings}
          onOpenKnowledgeSkills={() => {
            setAppSettingsOpen(false);
            setLibraryOpen(true);
          }}
          onOpenSharedMemory={() => {
            setAppSettingsOpen(false);
            setMemoryScope("user");
            setMemoryOpen(true);
          }}
          onOpenWorkspace={() => api.workspace.open()}
          onSaved={setSettings}
        />
      ) : null}
      {activeBot && botSettingsOpen ? (
        <LocalBotSettingsDialog
          open={botSettingsOpen}
          onOpenChange={setBotSettingsOpen}
          api={api}
          bot={activeBot}
          onOpenCredentials={() => {
            setBotSettingsOpen(false);
            setSecretsOpen(true);
          }}
          onSaved={(nextBot) =>
            setBots((current) =>
              current.map((bot) => (bot.id === nextBot.id ? nextBot : bot)),
            )
          }
        />
      ) : null}
      {activeBot ? (
        <LocalSecretsDialog
          open={secretsOpen}
          onOpenChange={setSecretsOpen}
          api={api}
          bot={activeBot}
        />
      ) : null}
      <LocalSecretPromptDialog
        request={secretRequest}
        api={api}
        onFinished={() => setSecretRequest(null)}
      />
      <LocalChoicePromptDialog
        request={choiceRequest}
        api={api}
        onFinished={() => setChoiceRequest(null)}
      />
      <LocalArchivedBotsDialog
        open={archivedBotsOpen}
        onOpenChange={setArchivedBotsOpen}
        api={api}
        onRestored={(bot) =>
          setBots((current) => [
            ...current.filter((candidate) => candidate.id !== bot.id),
            bot,
          ])
        }
      />
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
        botName={(botId) =>
          bots.find((bot) => bot.id === botId)?.name ?? t`Bot`
        }
        groupName={(groupId) =>
          groupId
            ? groups.find((group) => group.id === groupId)?.name
            : undefined
        }
      />
      {(activeBot || memoryScope === "user") && memoryOpen ? (
        <LocalMemoryDialog
          open={memoryOpen}
          onOpenChange={setMemoryOpen}
          api={api}
          bot={activeBot ?? undefined}
          scope={memoryScope}
        />
      ) : null}
      <LocalKnowledgeSkillsDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        api={api}
      />
      {activeBot ? (
        <LocalRoutinesDialog
          open={routinesOpen}
          onOpenChange={setRoutinesOpen}
          api={api}
          bot={activeBot}
        />
      ) : null}
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        bots={bots}
        onSelectBot={(botId) => {
          setActiveTarget({ kind: "bot", id: botId });
          setError(null);
        }}
      />
    </div>
  );
}

export function LocalApp({ bridge }: { bridge?: LocalBridge }) {
  return (
    <MemoryRouter initialEntries={["/"]}>
      <LocalAppContent bridge={bridge} />
    </MemoryRouter>
  );
}
