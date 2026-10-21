import type { DesktopActivityRun, DesktopActivityTool } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from "@rakazo/ui-web";
import { AlertTriangle, Check, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { LocalBridge } from "./types";

function duration(start: string, end: string | null): string {
  if (!end) return "running";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  return ms < 1_000 ? `${ms} ms` : `${(ms / 1_000).toFixed(1)} s`;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusIcon(status: DesktopActivityRun["status"]) {
  if (status === "running") return <LoaderCircle size={13} className="animate-spin text-link" />;
  if (status === "failed") return <AlertTriangle size={13} className="text-destructive" />;
  return <Check size={13} className="text-success" />;
}

function ToolRow({ tool }: { tool: DesktopActivityTool }) {
  return (
    <details className="rounded-lg border border-border/70 bg-background/30">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-[12px]">
        {tool.status === "running" ? (
          <LoaderCircle size={12} className="animate-spin text-link" />
        ) : tool.status === "failed" ? (
          <AlertTriangle size={12} className="text-destructive" />
        ) : (
          <Check size={12} className="text-success" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono">{tool.toolName}</span>
        <span className="text-muted-foreground">{duration(tool.startedAt, tool.endedAt)}</span>
      </summary>
      <div className="grid gap-2 border-t border-border/60 p-2.5 text-[11.5px]">
        <div>
          <p className="mb-1 font-medium text-muted-foreground">Arguments</p>
          <pre className="rk-scroll max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 font-mono">
            {JSON.stringify(tool.arguments, null, 2)}
          </pre>
        </div>
        {tool.result !== null ? (
          <div>
            <p className="mb-1 font-medium text-muted-foreground">Result</p>
            <pre className="rk-scroll max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 font-mono">
              {JSON.stringify(tool.result, null, 2)}
            </pre>
          </div>
        ) : null}
        {tool.error ? <p className="text-destructive">{tool.error}</p> : null}
      </div>
    </details>
  );
}

export function LocalActivityDialog({
  open,
  onOpenChange,
  api,
  botName,
  groupName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: LocalBridge;
  botName: (botId: string) => string;
  groupName: (groupId: string | null) => string | undefined;
}) {
  const [runs, setRuns] = useState<DesktopActivityRun[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRuns(null);
    setError("");
    void api.activity
      .list(50)
      .then((next) => {
        if (!cancelled) setRuns(next);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(760px,calc(100vh-3rem))] overflow-y-auto bg-background shadow-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Activity</DialogTitle>
          <DialogDescription>
            Local run and tool history. Arguments and results stay on this device.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p role="alert" className="text-[12.5px] text-destructive">
            {error}
          </p>
        ) : null}

        {runs === null ? (
          <div className="grid gap-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : runs.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-muted-foreground">
            No activity recorded yet.
          </div>
        ) : (
          <div className="grid gap-3">
            {runs.map((run) => (
              <article key={run.id} className="rounded-xl border border-border p-3">
                <div className="flex items-start gap-2">
                  {statusIcon(run.status)}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">
                      {run.groupId ? (groupName(run.groupId) ?? "Group") : botName(run.botId)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {dateLabel(run.startedAt)} · {duration(run.startedAt, run.endedAt)} ·{" "}
                      {run.tools.length === 1 ? "1 tool" : `${run.tools.length} tools`}
                    </p>
                  </div>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                    {run.status}
                  </span>
                </div>
                {run.error ? (
                  <p className="mt-2 rounded-md bg-destructive/10 px-2 py-1.5 text-[11.5px] text-destructive">
                    {run.error}
                  </p>
                ) : null}
                {run.tools.length ? (
                  <div className="mt-2 grid gap-1.5">
                    {run.tools.map((tool) => (
                      <ToolRow key={tool.id} tool={tool} />
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}

        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
}
