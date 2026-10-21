import { Trans } from "@lingui/react/macro";
import type { DesktopLocalChoiceRequest } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@rakazo/ui-web";
import { useState } from "react";
import type { LocalBridge } from "./types";
import { localErrorMessage } from "./types";

export function LocalChoicePromptDialog({
  request,
  api,
  onFinished,
}: {
  request: DesktopLocalChoiceRequest | null;
  api: LocalBridge;
  onFinished: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function respond(answer: string | null) {
    if (!request || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.prompts.respondChoice(request.requestId, answer);
      onFinished();
    } catch (cause) {
      setError(localErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

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
            <Trans>Choose an answer</Trans>
          </DialogTitle>
          <DialogDescription>{request?.question}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {request?.options.map((option) => (
            <Button
              key={option}
              type="button"
              variant="outline"
              className="h-auto justify-start whitespace-normal py-2.5 text-start"
              disabled={busy}
              onClick={() => void respond(option)}
            >
              {option}
            </Button>
          ))}
        </div>
        {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void respond(null)}>
            <Trans>Cancel</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
