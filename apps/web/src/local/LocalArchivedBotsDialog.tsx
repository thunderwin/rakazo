import { Trans } from "@lingui/react/macro";
import type { DesktopLocalBot } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from "@rakazo/ui-web";
import { ArchiveRestore, LoaderCircle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { LocalBridge } from "./types";
import { localErrorMessage } from "./types";

export function LocalArchivedBotsDialog({
  open,
  onOpenChange,
  api,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: LocalBridge;
  onRestored: (bot: DesktopLocalBot) => void;
}) {
  const [bots, setBots] = useState<DesktopLocalBot[] | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBots(null);
    setError("");
    void api.bots
      .archived()
      .then((next) => {
        if (!cancelled) setBots(next);
      })
      .catch((cause) => {
        if (!cancelled) setError(localErrorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [api, open]);

  async function restore(bot: DesktopLocalBot) {
    setRestoring(bot.id);
    setError("");
    try {
      const restored = await api.bots.restore(bot.id);
      setBots((current) => current?.filter((candidate) => candidate.id !== bot.id) ?? []);
      onRestored(restored);
    } catch (cause) {
      setError(localErrorMessage(cause));
    } finally {
      setRestoring(null);
    }
  }

  async function deletePermanently(bot: DesktopLocalBot) {
    if (deleting !== bot.id) {
      setDeleting(bot.id);
      return;
    }
    setRestoring(bot.id);
    setError("");
    try {
      await api.bots.deleteArchived(bot.id);
      setBots((current) => current?.filter((candidate) => candidate.id !== bot.id) ?? []);
      setDeleting(null);
    } catch (cause) {
      setError(localErrorMessage(cause));
    } finally {
      setRestoring(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(640px,calc(100vh-3rem))] overflow-y-auto bg-background shadow-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans>Archived bots</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Archived bots keep their chats, memory, and files.</Trans>
          </DialogDescription>
        </DialogHeader>
        {bots === null ? (
          <Skeleton className="h-20 w-full" />
        ) : bots.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted-foreground">
            <Trans>No archived bots.</Trans>
          </p>
        ) : (
          <div className="grid gap-2">
            {bots.map((bot) => (
              <div
                key={bot.id}
                className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5"
              >
                <span className="grid size-8 place-items-center rounded-full bg-muted">
                  <ArchiveRestore size={14} className="text-muted-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{bot.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {bot.description || bot.title}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={restoring !== null}
                  onClick={() => void restore(bot)}
                >
                  {restoring === bot.id ? (
                    <LoaderCircle size={13} className="animate-spin" />
                  ) : null}
                  <Trans>Restore</Trans>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={deleting === bot.id ? "text-destructive" : undefined}
                  disabled={restoring !== null}
                  onClick={() => void deletePermanently(bot)}
                >
                  <Trash2 size={13} />
                  {deleting === bot.id ? <Trans>Confirm delete</Trans> : <Trans>Delete</Trans>}
                </Button>
              </div>
            ))}
          </div>
        )}
        {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          <Trans>Close</Trans>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
