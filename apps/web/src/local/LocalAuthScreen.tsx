import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@rakazo/ui-web";
import { Bot, LoaderCircle } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { LocalBridge } from "./types";
import { localErrorMessage } from "./types";

export function LocalAuthScreen({
  api,
  serverUrl,
  onSignedIn,
}: {
  api: LocalBridge;
  serverUrl: string;
  onSignedIn: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "sign-up") await api.auth.signUp(name, email, password);
      else await api.auth.login(email, password);
      setPassword("");
      await onSignedIn();
    } catch (cause) {
      setError(localErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-0 flex-1 place-items-center overflow-auto bg-background px-6 py-12">
      <form
        className="w-full max-w-[390px] rounded-[24px] border border-border bg-card p-6 shadow-2xl"
        onSubmit={(event) => void submit(event)}
      >
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Bot size={23} strokeWidth={1.8} />
          </span>
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">ericBot</h1>
            <p className="text-[12.5px] text-muted-foreground">
              <Trans>Your local AI workspace</Trans>
            </p>
          </div>
        </div>

        <div className="grid gap-3">
          {mode === "sign-up" ? (
            <label
              htmlFor="local-auth-name"
              className="grid gap-1.5 text-[12.5px] text-muted-foreground"
            >
              <Trans>Name</Trans>
              <Input
                id="local-auth-name"
                value={name}
                autoComplete="name"
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          ) : null}
          <label
            htmlFor="local-auth-email"
            className="grid gap-1.5 text-[12.5px] text-muted-foreground"
          >
            <Trans>Email</Trans>
            <Input
              id="local-auth-email"
              type="email"
              value={email}
              autoComplete="username"
              required
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label
            htmlFor="local-auth-password"
            className="grid gap-1.5 text-[12.5px] text-muted-foreground"
          >
            <Trans>Password</Trans>
            <Input
              id="local-auth-password"
              type="password"
              value={password}
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              minLength={8}
              required
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive"
            >
              {error}
            </p>
          ) : null}
          <Button type="submit" className="mt-1 h-9 w-full" disabled={busy}>
            {busy ? <LoaderCircle size={14} className="animate-spin" /> : null}
            {mode === "sign-in" ? t`Sign in` : t`Create account`}
          </Button>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 text-[12.5px]">
          <span className="truncate text-muted-foreground" title={serverUrl}>
            {serverUrl}
          </span>
          <button
            type="button"
            className="shrink-0 text-foreground underline-offset-3 hover:underline"
            onClick={() => {
              setMode((current) => (current === "sign-in" ? "sign-up" : "sign-in"));
              setError("");
            }}
          >
            {mode === "sign-in" ? t`Create account` : t`Back to sign in`}
          </button>
        </div>
      </form>
    </main>
  );
}
