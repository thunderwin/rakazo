import type { DesktopBrowserBridgeStatus } from "@rakazo/contracts";
import { GROK_COLOR_LIST, resolvePersonaColorDef } from "@rakazo/core";
import {
  BotAvatar,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from "@rakazo/ui-web";
import { Check, Copy, ExternalLink, LoaderCircle, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { type LocalBot, type LocalBridge, type LocalSettings, localErrorMessage } from "./types";

export function LocalSettingsDialog({
  open,
  onOpenChange,
  api,
  bot,
  settings,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: LocalBridge;
  bot: LocalBot;
  settings: LocalSettings;
  onSaved: (settings: LocalSettings, bot?: LocalBot) => void;
}) {
  const [theme, setTheme] = useState(settings.theme);
  const [enterToSend, setEnterToSend] = useState(settings.sendWithEnter);
  const [defaultModel, setDefaultModel] = useState(settings.defaultModelId ?? "");
  const [name, setName] = useState(bot.name);
  const [description, setDescription] = useState(bot.description);
  const [model, setModel] = useState(bot.modelId ?? "");
  const [thinking, setThinking] = useState(bot.thinkingLevel ?? "");
  const [instructions, setInstructions] = useState(bot.instructions);
  const [color, setColor] = useState(bot.color);
  const [browser, setBrowser] = useState<DesktopBrowserBridgeStatus | null>(null);
  const [pairing, setPairing] = useState<{ port: number; code: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState("");
  const managed = bot.source === "managed";

  useEffect(() => {
    if (!open) return;
    setTheme(settings.theme);
    setEnterToSend(settings.sendWithEnter);
    setDefaultModel(settings.defaultModelId ?? "");
    setName(bot.name);
    setDescription(bot.description);
    setModel(bot.modelId ?? "");
    setThinking(bot.thinkingLevel ?? "");
    setInstructions(bot.instructions);
    setColor(bot.color);
    setError("");
    setDiagnostics("");
    setPairing(null);
  }, [bot, open, settings]);

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
      const nextBot = managed
        ? undefined
        : await api.bots.update(bot.id, {
            name: name.trim(),
            description: description.trim(),
            instructions,
            modelId: model.trim() || null,
            thinkingLevel: thinking || null,
            color,
          });
      onSaved(nextSettings, nextBot);
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
      setDiagnostics("Copied. No messages, cookies, or tokens are included.");
    } catch (cause) {
      setDiagnostics(localErrorMessage(cause));
    }
  }

  const browserColor = browser?.connected ? "bg-success" : "bg-muted-foreground/45";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(760px,calc(100vh-3rem))] overflow-y-auto bg-background shadow-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Local preferences, browser access, and the current bot profile.
          </DialogDescription>
        </DialogHeader>

        <section className="grid gap-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            General
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label
              htmlFor="local-settings-default-model"
              className="grid gap-1.5 text-[12px] text-muted-foreground"
            >
              Default model
              <Input
                id="local-settings-default-model"
                value={defaultModel}
                onChange={(event) => setDefaultModel(event.target.value)}
                placeholder="Use the bot model"
              />
            </label>
            <label
              htmlFor="local-settings-theme"
              className="grid gap-1.5 text-[12px] text-muted-foreground"
            >
              Appearance
              <select
                id="local-settings-theme"
                className="h-8 rounded-lg border border-border bg-input px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                value={theme}
                onChange={(event) => setTheme(event.target.value as "system" | "light" | "dark")}
              >
                <option value="system">System</option>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
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
            Enter sends the message
          </label>
        </section>

        <section className="grid gap-3 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Browser
              </h3>
              <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <span className={`size-1.5 rounded-full ${browserColor}`} />
                {browser?.connected
                  ? "Chrome connected"
                  : browser?.available
                    ? "Chrome not connected"
                    : browser?.error || "Browser bridge unavailable"}
              </p>
            </div>
            <div className="flex gap-1.5">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void startPairing()}
              >
                {browser?.connected ? "Pair another" : "Connect"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!browser?.connected}
                onClick={() => void disconnectBrowser()}
              >
                <Unplug size={13} />
                Disconnect
              </Button>
            </div>
          </div>
          <p className="text-[12px] leading-5 text-muted-foreground">
            The agent uses the Chrome profile where the extension is installed. Page text can enter
            model requests; cookies are never exported.
          </p>
          {pairing ? (
            <div className="rounded-xl border border-border bg-muted/45 px-3 py-2.5 text-[13px]">
              In the extension, enter port <strong>{pairing.port}</strong> and code{" "}
              <strong className="font-mono tracking-[0.12em]">{pairing.code}</strong>.
            </div>
          ) : null}
        </section>

        <section className="grid gap-3 border-t border-border pt-4">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Current bot
          </h3>
          <div className="flex items-center gap-3">
            <BotAvatar color={color} identity={bot.id} size={42} />
            <div className="min-w-0 flex-1">
              <Input
                value={name}
                disabled={managed}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
              />
              <p className="mt-1 truncate text-[11.5px] text-muted-foreground">
                {resolvePersonaColorDef(bot.id, color).name}
              </p>
            </div>
          </div>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">Bot color</legend>
            {GROK_COLOR_LIST.map((item) => (
              <button
                key={item.id}
                type="button"
                title={item.name}
                aria-label={item.name}
                aria-pressed={color === item.id || color === item.hex}
                disabled={managed}
                className="grid size-7 place-items-center rounded-full border border-border focus-visible:ring-2 focus-visible:ring-ring"
                style={{ backgroundColor: item.hex }}
                onClick={() => setColor(item.id)}
              >
                {color === item.id || color === item.hex ? (
                  <Check size={13} style={{ color: item.eyeColor }} />
                ) : null}
              </button>
            ))}
          </fieldset>
          <label
            htmlFor="local-settings-description"
            className="grid gap-1.5 text-[12px] text-muted-foreground"
          >
            Description
            <Input
              id="local-settings-description"
              value={description}
              disabled={managed}
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label
              htmlFor="local-settings-model"
              className="grid gap-1.5 text-[12px] text-muted-foreground"
            >
              Bot model
              <Input
                id="local-settings-model"
                value={model}
                disabled={managed}
                placeholder="Use the default"
                onChange={(event) => setModel(event.target.value)}
              />
            </label>
            <label
              htmlFor="local-settings-thinking"
              className="grid gap-1.5 text-[12px] text-muted-foreground"
            >
              Thinking
              <select
                id="local-settings-thinking"
                disabled={managed}
                className="h-8 rounded-lg border border-border bg-input px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                value={thinking}
                onChange={(event) => setThinking(event.target.value)}
              >
                <option value="">Default</option>
                {["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label
            htmlFor="local-settings-instructions"
            className="grid gap-1.5 text-[12px] text-muted-foreground"
          >
            Instructions
            <Textarea
              id="local-settings-instructions"
              rows={6}
              disabled={managed}
              maxLength={40_000}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </label>
          {managed ? (
            <p className="text-[11.5px] text-muted-foreground">
              Managed by your organization. Update the assigned preset on the server to change it.
            </p>
          ) : null}
        </section>

        <section className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" size="sm" onClick={() => void copyDiagnostics()}>
            <Copy size={13} />
            Copy diagnostics
          </Button>
          <a
            className="inline-flex items-center gap-1 text-[12px] text-link underline-offset-3 hover:underline"
            href="https://github.com/thunderwin/rakazo/issues"
            target="_blank"
            rel="noreferrer"
          >
            Report an issue
            <ExternalLink size={11} />
          </a>
          {diagnostics ? (
            <span className="text-[12px] text-muted-foreground">{diagnostics}</span>
          ) : null}
        </section>

        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving || (!managed && !name.trim())}
            onClick={() => void save()}
          >
            {saving ? <LoaderCircle size={13} className="animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
