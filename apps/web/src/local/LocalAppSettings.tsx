import { Trans, useLingui } from "@lingui/react/macro";
import type { DesktopBrowserBridgeStatus } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@rakazo/ui-web";
import {
  Brain,
  Copy,
  ExternalLink,
  FolderOpen,
  LibraryBig,
  LoaderCircle,
  Unplug,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ListboxSelect } from "../components/ListboxSelect";
import { getActiveUiLocale, setUiLocale } from "../lib/i18n";
import type { UiLocale } from "../lib/ui-locale";
import { LOCAL_UI_LOCALES, UI_LOCALE_LABELS } from "../lib/ui-locale";
import type { LocalBridge, LocalSettings } from "./types";
import { localErrorMessage } from "./types";

export function LocalAppSettingsDialog({
  open,
  onOpenChange,
  api,
  settings,
  onOpenKnowledgeSkills,
  onOpenSharedMemory,
  onOpenWorkspace,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: LocalBridge;
  settings: LocalSettings;
  onOpenKnowledgeSkills: () => void;
  onOpenSharedMemory: () => void;
  onOpenWorkspace: () => Promise<void>;
  onSaved: (settings: LocalSettings) => void;
}) {
  const { t } = useLingui();
  const [theme, setTheme] = useState(settings.theme);
  const [enterToSend, setEnterToSend] = useState(settings.sendWithEnter);
  const [defaultModel, setDefaultModel] = useState(
    settings.defaultModelId ?? "",
  );
  const [browser, setBrowser] = useState<DesktopBrowserBridgeStatus | null>(
    null,
  );
  const [pairing, setPairing] = useState<{ port: number; code: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState("");
  const [language, setLanguage] = useState<UiLocale>(() => getActiveUiLocale());

  useEffect(() => {
    if (!open) return;
    setTheme(settings.theme);
    setEnterToSend(settings.sendWithEnter);
    setDefaultModel(settings.defaultModelId ?? "");
    setLanguage(getActiveUiLocale());
    setError("");
    setDiagnostics("");
    setPairing(null);
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const refresh = async () => {
      const next = await api.browser.status().catch(() => null);
      if (!cancelled) setBrowser(next);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, open]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const nextSettings = await api.settings.update({
        theme,
        sendWithEnter: enterToSend,
        defaultModelId: defaultModel.trim() || null,
      });
      const activated = await setUiLocale(language);
      setLanguage(activated);
      onSaved(nextSettings);
      onOpenChange(false);
    } catch (cause) {
      setError(localErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function startPairing() {
    setError("");
    try {
      const offer = await api.browser.startPairing();
      setPairing({ port: offer.port, code: offer.code });
    } catch (cause) {
      setError(localErrorMessage(cause));
    }
  }

  async function disconnectBrowser() {
    setError("");
    try {
      setBrowser(await api.browser.revoke());
      setPairing(null);
    } catch (cause) {
      setError(localErrorMessage(cause));
    }
  }

  async function copyDiagnostics() {
    setDiagnostics("");
    try {
      await api.diagnostics.copy();
      setDiagnostics(t`Copied. No messages, cookies, or tokens are included.`);
    } catch (cause) {
      setDiagnostics(localErrorMessage(cause));
    }
  }

  const browserColor = browser?.connected
    ? "bg-success"
    : "bg-muted-foreground/45";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(760px,calc(100vh-3rem))] overflow-y-auto bg-background shadow-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <Trans>App settings</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              Language, appearance, browser access, and defaults for this
              device.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <section className="grid gap-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <Trans>General</Trans>
          </h3>
          <div className="grid gap-1.5 text-[12px] text-muted-foreground">
            <span>
              <Trans>Language</Trans>
            </span>
            <ListboxSelect
              testId="local-ui-locale-select"
              label={t`Language`}
              value={language}
              options={LOCAL_UI_LOCALES.map((code) => ({
                value: code,
                label: UI_LOCALE_LABELS[code],
              }))}
              onChange={setLanguage}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label
              htmlFor="local-app-settings-default-model"
              className="grid gap-1.5 text-[12px] text-muted-foreground"
            >
              <Trans>Default model</Trans>
              <Input
                id="local-app-settings-default-model"
                value={defaultModel}
                onChange={(event) => setDefaultModel(event.target.value)}
                placeholder={t`Use the bot model`}
              />
            </label>
            <label
              htmlFor="local-app-settings-theme"
              className="grid gap-1.5 text-[12px] text-muted-foreground"
            >
              <Trans>Appearance</Trans>
              <select
                id="local-app-settings-theme"
                className="h-8 rounded-lg border border-border bg-input px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                value={theme}
                onChange={(event) =>
                  setTheme(event.target.value as "system" | "light" | "dark")
                }
              >
                <option value="system">{t`System`}</option>
                <option value="dark">{t`Dark`}</option>
                <option value="light">{t`Light`}</option>
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              className="size-4 accent-foreground"
              checked={enterToSend}
              onChange={(event) => setEnterToSend(event.target.checked)}
            />
            <Trans>Enter sends the message</Trans>
          </label>
        </section>

        <section className="grid gap-3 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                <Trans>Browser</Trans>
              </h3>
              <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <span className={`size-1.5 rounded-full ${browserColor}`} />
                {browser?.connected
                  ? t`Chrome connected`
                  : browser?.available
                    ? t`Chrome not connected`
                    : browser?.error || t`Browser bridge unavailable`}
              </p>
            </div>
            <div className="flex gap-1.5">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void startPairing()}
              >
                {browser?.connected ? t`Pair another` : t`Connect`}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!browser?.connected}
                onClick={() => void disconnectBrowser()}
              >
                <Unplug size={13} />
                <Trans>Disconnect</Trans>
              </Button>
            </div>
          </div>
          <p className="text-[12px] leading-5 text-muted-foreground">
            <Trans>
              The agent uses the Chrome profile where the extension is
              installed. Page text can enter model requests; cookies are never
              exported.
            </Trans>
          </p>
          {pairing ? (
            <div className="rounded-xl border border-border bg-muted/45 px-3 py-2.5 text-[13px]">
              <Trans>
                In the extension, enter port <strong>{pairing.port}</strong> and
                code{" "}
                <strong className="font-mono tracking-[0.12em]">
                  {pairing.code}
                </strong>
                .
              </Trans>
            </div>
          ) : null}
        </section>

        <section className="grid gap-3 border-t border-border pt-4">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <Trans>Account resources</Trans>
          </h3>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenKnowledgeSkills}
            >
              <LibraryBig size={14} />
              <Trans>Knowledge and skills</Trans>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenSharedMemory}
            >
              <Brain size={14} />
              <Trans>Shared memory</Trans>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onOpenWorkspace()}
            >
              <FolderOpen size={14} />
              <Trans>Open workspace</Trans>
            </Button>
          </div>
        </section>

        <section className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void copyDiagnostics()}
          >
            <Copy size={13} />
            <Trans>Copy diagnostics</Trans>
          </Button>
          <a
            className="inline-flex items-center gap-1 text-[12px] text-link underline-offset-3 hover:underline"
            href="https://github.com/thunderwin/rakazo/issues"
            target="_blank"
            rel="noreferrer"
          >
            <Trans>Report an issue</Trans>
            <ExternalLink size={11} />
          </a>
          {diagnostics ? (
            <span className="text-[12px] text-muted-foreground">
              {diagnostics}
            </span>
          ) : null}
        </section>

        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            <Trans>Cancel</Trans>
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save()}>
            {saving ? (
              <LoaderCircle size={13} className="animate-spin" />
            ) : null}
            <Trans>Save</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
