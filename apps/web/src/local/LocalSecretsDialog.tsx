import { Trans, useLingui } from "@lingui/react/macro";
import type {
  DesktopLocalBot,
  DesktopLocalSecret,
  DesktopLocalSecretAuth,
  DesktopLocalSecretRequest,
} from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Skeleton,
} from "@rakazo/ui-web";
import { KeyRound, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { LocalBridge } from "./types";
import { localErrorMessage } from "./types";

type AuthType = "bearer" | "header" | "basic" | "login" | "command";

function authLabel(auth: DesktopLocalSecretAuth): string {
  if (auth.type === "header") return `Header: ${auth.name}`;
  if (auth.type === "basic") return `Basic: ${auth.username}`;
  if (auth.type === "login") return "Website login";
  if (auth.type === "command") return "Command variable";
  return "Bearer token";
}

function authValue(type: AuthType, headerName: string, username: string): DesktopLocalSecretAuth {
  if (type === "header") return { type, name: headerName.trim() };
  if (type === "basic") return { type, username: username.trim() };
  if (type === "login") return { type };
  if (type === "command") return { type };
  return { type };
}

export function LocalSecretsDialog({
  open,
  onOpenChange,
  api,
  bot,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: LocalBridge;
  bot: DesktopLocalBot;
}) {
  const { t } = useLingui();
  const [secrets, setSecrets] = useState<DesktopLocalSecret[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");
  const [type, setType] = useState<AuthType>("bearer");
  const [headerName, setHeaderName] = useState("X-API-Key");
  const [username, setUsername] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSecrets(null);
    setAdding(false);
    setError("");
    void api.secrets
      .list(bot.id)
      .then((next) => {
        if (!cancelled) setSecrets(next);
      })
      .catch((cause) => {
        if (!cancelled) setError(localErrorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [api, bot.id, open]);

  function resetForm() {
    setName("");
    setOrigin("");
    setType("bearer");
    setHeaderName("X-API-Key");
    setUsername("");
    setValue("");
    setError("");
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api.secrets.put(bot.id, {
        name: name.trim(),
        origin: type === "command" ? "" : origin.trim(),
        auth: authValue(type, headerName, username),
        value:
          type === "login" ? JSON.stringify({ username: username.trim(), password: value }) : value,
      });
      setSecrets((current) => [
        saved,
        ...(current ?? []).filter((entry) => entry.name !== saved.name),
      ]);
      setAdding(false);
      resetForm();
    } catch (cause) {
      setError(localErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(secret: DesktopLocalSecret) {
    setBusy(true);
    setError("");
    try {
      await api.secrets.remove(bot.id, secret.name);
      setSecrets((current) => current?.filter((entry) => entry.name !== secret.name) ?? []);
    } catch (cause) {
      setError(localErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(760px,calc(100vh-3rem))] overflow-y-auto bg-background shadow-2xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            <Trans>Credentials</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Protected values stay on this device and are never returned to the model.</Trans>
          </DialogDescription>
        </DialogHeader>

        {adding ? (
          <div className="grid gap-3">
            <label
              htmlFor="local-secret-name"
              className="grid gap-1.5 text-[12px] text-muted-foreground"
            >
              <Trans>Name</Trans>
              <Input
                id="local-secret-name"
                value={name}
                maxLength={64}
                placeholder="github"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-[12px] text-muted-foreground">
                <Trans>Authentication</Trans>
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={type}
                  onChange={(event) => setType(event.target.value as AuthType)}
                >
                  <option value="bearer">{t`Bearer token`}</option>
                  <option value="header">{t`Custom header`}</option>
                  <option value="basic">{t`Basic auth`}</option>
                  <option value="login">{t`Website login`}</option>
                  <option value="command">{t`Command variable`}</option>
                </select>
              </label>
              <label
                htmlFor="local-secret-origin"
                className="grid gap-1.5 text-[12px] text-muted-foreground"
              >
                <Trans>HTTPS origin</Trans>
                <Input
                  id="local-secret-origin"
                  value={origin}
                  disabled={type === "command"}
                  placeholder="https://api.example.com"
                  onChange={(event) => setOrigin(event.target.value)}
                />
              </label>
            </div>
            {type === "header" ? (
              <label
                htmlFor="local-secret-header"
                className="grid gap-1.5 text-[12px] text-muted-foreground"
              >
                <Trans>Header name</Trans>
                <Input
                  id="local-secret-header"
                  value={headerName}
                  maxLength={120}
                  onChange={(event) => setHeaderName(event.target.value)}
                />
              </label>
            ) : null}
            {type === "basic" || type === "login" ? (
              <label
                htmlFor="local-secret-username"
                className="grid gap-1.5 text-[12px] text-muted-foreground"
              >
                <Trans>Username</Trans>
                <Input
                  id="local-secret-username"
                  value={username}
                  maxLength={512}
                  autoComplete="username"
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
            ) : null}
            <label
              htmlFor="local-secret-value"
              className="grid gap-1.5 text-[12px] text-muted-foreground"
            >
              <Trans>{type === "login" ? "Password" : "Value"}</Trans>
              <Input
                id="local-secret-value"
                type="password"
                value={value}
                maxLength={16_384}
                autoComplete="new-password"
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
            {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={
                  busy ||
                  !name.trim() ||
                  !value ||
                  (type !== "command" && !origin.trim()) ||
                  (type === "header" && !headerName.trim()) ||
                  ((type === "basic" || type === "login") && !username.trim())
                }
                onClick={() => void save()}
              >
                {busy ? <LoaderCircle size={13} className="animate-spin" /> : null}
                <Trans>Save credential</Trans>
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setAdding(false);
                  resetForm();
                }}
              >
                <Trans>Cancel</Trans>
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              className="justify-self-start"
              onClick={() => setAdding(true)}
            >
              <Plus size={13} />
              <Trans>Add credential</Trans>
            </Button>
            {secrets === null ? (
              <Skeleton className="h-16 w-full" />
            ) : secrets.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-muted-foreground">
                <Trans>No credentials saved for this bot.</Trans>
              </p>
            ) : (
              <div className="grid gap-2">
                {secrets.map((secret) => (
                  <div
                    key={secret.name}
                    className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5"
                  >
                    <KeyRound size={15} className="text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{secret.name}</p>
                      <p className="truncate text-[11.5px] text-muted-foreground">
                        {authLabel(secret.auth)} · {secret.origin || t`This device`}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t`Remove credential`}
                      disabled={busy}
                      onClick={() => void remove(secret)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {!adding && error ? <p className="text-[12px] text-destructive">{error}</p> : null}
        {!adding ? (
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              <Trans>Close</Trans>
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function LocalSecretPromptDialog({
  request,
  api,
  onFinished,
}: {
  request: DesktopLocalSecretRequest | null;
  api: LocalBridge;
  onFinished: () => void;
}) {
  const { t } = useLingui();
  const [username, setUsername] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setUsername("");
    setValue("");
    setBusy(false);
    setError("");
  }, [request?.requestId]);

  async function respond(answer: { value: string; username?: string } | null) {
    if (!request || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.secrets.respond(request.requestId, answer);
      onFinished();
    } catch (cause) {
      setError(localErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  const login = request?.auth.type === "login";
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) void respond(null);
      }}
    >
      <DialogContent className="bg-background shadow-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <Trans>Protected input</Trans>
          </DialogTitle>
          <DialogDescription>
            {request?.reason ||
              t`The agent needs a credential. It will not be shown to the model or sent in chat.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-[12px]">
            <p className="font-medium">{request?.name}</p>
            <p className="truncate text-muted-foreground">{request?.origin}</p>
          </div>
          {login ? (
            <label
              htmlFor="local-secret-prompt-username"
              className="grid gap-1.5 text-[12px] text-muted-foreground"
            >
              <Trans>Username</Trans>
              <Input
                id="local-secret-prompt-username"
                autoFocus
                value={username}
                maxLength={512}
                autoComplete="username"
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
          ) : null}
          <label
            htmlFor="local-secret-prompt-value"
            className="grid gap-1.5 text-[12px] text-muted-foreground"
          >
            <Trans>{login ? "Password" : "Value"}</Trans>
            <Input
              id="local-secret-prompt-value"
              autoFocus={!login}
              type="password"
              value={value}
              maxLength={16_384}
              autoComplete="new-password"
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void respond(null)}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            type="button"
            disabled={busy || !value || (login && !username.trim())}
            onClick={() =>
              void respond({
                value,
                ...(login ? { username: username.trim() } : {}),
              })
            }
          >
            {busy ? <LoaderCircle size={13} className="animate-spin" /> : null}
            <Trans>Continue</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
