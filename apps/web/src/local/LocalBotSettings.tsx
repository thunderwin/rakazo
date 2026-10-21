import { Trans, useLingui } from "@lingui/react/macro";
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
import { Check, KeyRound, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { LocalScratchpadSection } from "./work-adapters";
import type { LocalBot, LocalBridge } from "./types";
import { localErrorMessage } from "./types";

export function LocalBotSettingsDialog({
  open,
  onOpenChange,
  api,
  bot,
  onSaved,
  onOpenCredentials,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: LocalBridge;
  bot: LocalBot;
  onSaved: (bot: LocalBot) => void;
  onOpenCredentials: () => void;
}) {
  const { t } = useLingui();
  const [name, setName] = useState(bot.name);
  const [description, setDescription] = useState(bot.description);
  const [model, setModel] = useState(bot.modelId ?? "");
  const [thinking, setThinking] = useState(bot.thinkingLevel ?? "");
  const [instructions, setInstructions] = useState(bot.instructions);
  const [color, setColor] = useState(bot.color);
  const [fleetManagement, setFleetManagement] = useState(bot.fleetManagement);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const managed = bot.source === "managed";

  useEffect(() => {
    if (!open) return;
    setName(bot.name);
    setDescription(bot.description);
    setModel(bot.modelId ?? "");
    setThinking(bot.thinkingLevel ?? "");
    setInstructions(bot.instructions);
    setColor(bot.color);
    setFleetManagement(bot.fleetManagement);
    setError("");
  }, [bot, open]);

  async function save() {
    if (managed) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const nextBot = await api.bots.update(bot.id, {
        name: name.trim(),
        description: description.trim(),
        instructions,
        modelId: model.trim() || null,
        thinkingLevel: thinking || null,
        color,
        fleetManagement,
      });
      onSaved(nextBot);
      onOpenChange(false);
    } catch (cause) {
      setError(localErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(720px,calc(100vh-3rem))] overflow-y-auto bg-background shadow-2xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            <Trans>Chat settings</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Name, model, instructions, and identity for this bot.</Trans>
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <BotAvatar color={color} identity={bot.id} size={42} />
          <div className="min-w-0 flex-1">
            <Input
              aria-label={t`Bot name`}
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
          <legend className="sr-only">
            <Trans>Bot color</Trans>
          </legend>
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
          htmlFor="local-bot-settings-description"
          className="grid gap-1.5 text-[12px] text-muted-foreground"
        >
          <Trans>Description</Trans>
          <Input
            id="local-bot-settings-description"
            value={description}
            disabled={managed}
            maxLength={2000}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label
            htmlFor="local-bot-settings-model"
            className="grid gap-1.5 text-[12px] text-muted-foreground"
          >
            <Trans>Bot model</Trans>
            <Input
              id="local-bot-settings-model"
              value={model}
              disabled={managed}
              placeholder={t`Use the default`}
              onChange={(event) => setModel(event.target.value)}
            />
          </label>
          <label
            htmlFor="local-bot-settings-thinking"
            className="grid gap-1.5 text-[12px] text-muted-foreground"
          >
            <Trans>Thinking</Trans>
            <select
              id="local-bot-settings-thinking"
              disabled={managed}
              className="h-8 rounded-lg border border-border bg-input px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              value={thinking}
              onChange={(event) => setThinking(event.target.value)}
            >
              <option value="">{t`Default`}</option>
              {["off", "minimal", "low", "medium", "high", "xhigh", "max"].map(
                (level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>

        <label className="flex items-start gap-2.5 rounded-xl border border-border px-3 py-2.5 text-[13px]">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-foreground"
            checked={fleetManagement}
            disabled={managed}
            onChange={(event) => setFleetManagement(event.target.checked)}
          />
          <span>
            <span className="block font-medium">
              <Trans>Fleet management</Trans>
            </span>
            <span className="mt-0.5 block text-[11.5px] leading-4 text-muted-foreground">
              <Trans>
                Let this bot create and manage bots it owns, plus their groups
                and routines.
              </Trans>
            </span>
          </span>
        </label>

        <label
          htmlFor="local-bot-settings-instructions"
          className="grid gap-1.5 text-[12px] text-muted-foreground"
        >
          <Trans>Instructions</Trans>
          <Textarea
            id="local-bot-settings-instructions"
            rows={7}
            disabled={managed}
            maxLength={40_000}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </label>

        <LocalScratchpadSection api={api} botId={bot.id} />

        <Button
          type="button"
          variant="outline"
          className="justify-self-start"
          onClick={onOpenCredentials}
        >
          <KeyRound size={13} />
          <Trans>Credentials</Trans>
        </Button>

        {managed ? (
          <p className="text-[11.5px] text-muted-foreground">
            <Trans>
              Managed by your organization. Update the assigned preset on the
              server to change it.
            </Trans>
          </p>
        ) : null}

        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          {managed ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              <Trans>Close</Trans>
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                <Trans>Cancel</Trans>
              </Button>
              <Button
                type="button"
                disabled={saving || !name.trim()}
                onClick={() => void save()}
              >
                {saving ? (
                  <LoaderCircle size={13} className="animate-spin" />
                ) : null}
                <Trans>Save</Trans>
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
