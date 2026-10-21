import type {
  DesktopLocalRoutineInput,
  DesktopLocalRoutineRun,
  DesktopLocalRoutine as Routine,
} from "@rakazo/contracts";
import { formatCron } from "@rakazo/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Skeleton,
  Textarea,
} from "@rakazo/ui-web";
import { ChevronLeft, LoaderCircle, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { type LocalBot, type LocalBridge, localErrorMessage } from "./types";

type ScheduleMode = "daily" | "weekdays" | "weekly" | "once" | "custom";

const MODE_LABELS: Record<ScheduleMode, string> = {
  daily: "Every day",
  weekdays: "Weekdays",
  weekly: "Every Monday",
  once: "One time",
  custom: "Custom cron",
};

function scheduleFields(cron: string): { mode: ScheduleMode; time: string; custom: string } {
  const value = cron.trim();
  const daily = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(value);
  const weekdays = /^(\d{1,2}) (\d{1,2}) \* \* 1-5$/.exec(value);
  const weekly = /^(\d{1,2}) (\d{1,2}) \* \* 1$/.exec(value);
  const match = daily ?? weekdays ?? weekly;
  if (match) {
    return {
      mode: daily ? "daily" : weekdays ? "weekdays" : "weekly",
      time: `${String(Number(match[2])).padStart(2, "0")}:${String(Number(match[1])).padStart(2, "0")}`,
      custom: value,
    };
  }
  if (value === "@once") return { mode: "once", time: "09:00", custom: value };
  return { mode: "custom", time: "09:00", custom: value };
}

function cronFor(mode: ScheduleMode, time: string, custom: string): string {
  if (mode === "once") return "@once";
  if (mode === "custom") return custom.trim();
  const [hour = "9", minute = "0"] = time.split(":");
  if (mode === "daily") return `${Number(minute)} ${Number(hour)} * * *`;
  if (mode === "weekdays") return `${Number(minute)} ${Number(hour)} * * 1-5`;
  return `${Number(minute)} ${Number(hour)} * * 1`;
}

function localDateTimeValue(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dateLabel(value: string | null): string {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function runLabel(run: DesktopLocalRoutineRun): string {
  return `${run.status} · ${run.trigger} · ${dateLabel(run.startedAt)}`;
}

export function LocalRoutinesDialog({
  open,
  onOpenChange,
  api,
  bot,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: LocalBridge;
  bot: LocalBot;
}) {
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<ScheduleMode>("daily");
  const [time, setTime] = useState("09:00");
  const [runAt, setRunAt] = useState("");
  const [customCron, setCustomCron] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [history, setHistory] = useState<DesktopLocalRoutineRun[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  async function loadRoutines() {
    const next = await api.routines.list(bot.id);
    setRoutines(next);
    return next;
  }

  async function loadHistory(routineId: string) {
    setHistory(null);
    const next = await api.routines.history(routineId, 10);
    setHistory(next);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRoutines(null);
    setEditingId(null);
    setHistory(null);
    setError("");
    void api.routines
      .list(bot.id)
      .then((next) => {
        if (!cancelled) setRoutines(next);
      })
      .catch((cause) => {
        if (!cancelled) setError(localErrorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [api, bot.id, open]);

  function beginNew() {
    setEditingId("new");
    setName("");
    setPrompt("");
    setMode("daily");
    setTime("09:00");
    setRunAt("");
    setCustomCron("");
    setEnabled(true);
    setHistory(null);
    setConfirmDelete(false);
    setError("");
  }

  function beginEdit(routine: Routine) {
    const schedule = scheduleFields(routine.cron);
    setEditingId(routine.id);
    setName(routine.name);
    setPrompt(routine.prompt);
    setMode(schedule.mode);
    setTime(schedule.time);
    setRunAt(localDateTimeValue(routine.nextRunAt));
    setCustomCron(schedule.custom);
    setEnabled(routine.enabled);
    setConfirmDelete(false);
    setError("");
    void loadHistory(routine.id).catch((cause) => setError(localErrorMessage(cause)));
  }

  function closeEditor() {
    setEditingId(null);
    setHistory(null);
    setConfirmDelete(false);
    setError("");
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const input: DesktopLocalRoutineInput = {
        name: name.trim(),
        prompt: prompt.trim(),
        cron: cronFor(mode, time, customCron),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        enabled,
        ...(mode === "once"
          ? {
              runAt: new Date(runAt).toISOString(),
            }
          : {}),
      };
      const saved =
        editingId === "new"
          ? await api.routines.create(bot.id, input)
          : await api.routines.update(editingId!, input);
      setRoutines((current) => {
        if (!current) return [saved];
        const exists = current.some((routine) => routine.id === saved.id);
        return exists
          ? current.map((routine) => (routine.id === saved.id ? saved : routine))
          : [...current, saved];
      });
      setEditingId(saved.id);
      await loadHistory(saved.id);
    } catch (cause) {
      setError(localErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    if (editingId === "new" || editingId === null || running) return;
    setRunning(true);
    setError("");
    try {
      await api.routines.runNow(editingId);
      await Promise.all([loadRoutines(), loadHistory(editingId)]);
    } catch (cause) {
      setError(localErrorMessage(cause));
    } finally {
      setRunning(false);
    }
  }

  async function remove() {
    if (editingId === "new" || editingId === null || saving) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.routines.remove(editingId);
      setRoutines((current) => current?.filter((routine) => routine.id !== editingId) ?? []);
      closeEditor();
    } catch (cause) {
      setError(localErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  const editing = routines?.find((routine) => routine.id === editingId);
  const managed = editing?.source === "managed";
  const valid =
    name.trim().length > 0 &&
    prompt.trim().length > 0 &&
    (mode !== "custom" || customCron.trim().length > 0) &&
    (mode !== "once" || runAt.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(800px,calc(100vh-3rem))] overflow-y-auto bg-background shadow-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Routines</DialogTitle>
          <DialogDescription>
            ericBot runs these locally while the app is open. Missed work runs once after the next
            launch.
          </DialogDescription>
        </DialogHeader>

        {editingId === null ? (
          <div className="grid gap-2">
            <div className="flex justify-end">
              <Button type="button" size="sm" onClick={beginNew}>
                <Plus size={13} />
                New routine
              </Button>
            </div>
            {routines === null ? (
              <>
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </>
            ) : routines.length === 0 ? (
              <p className="py-10 text-center text-[13px] text-muted-foreground">
                No routines yet.
              </p>
            ) : (
              routines.map((routine) => (
                <Button
                  key={routine.id}
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start whitespace-normal rounded-xl border border-border px-3 py-2.5"
                  onClick={() => beginEdit(routine)}
                >
                  <span className="flex w-full items-start justify-between gap-3">
                    <span className="min-w-0 text-start">
                      <span className="block truncate text-[13.5px] text-foreground">
                        {routine.name}
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                        {formatCron(routine.cron)} · Next {dateLabel(routine.nextRunAt)}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      {routine.enabled ? "Active" : "Paused"}
                    </span>
                  </span>
                </Button>
              ))
            )}
          </div>
        ) : (
          <div className="grid gap-3">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="me-auto -ms-2"
              onClick={closeEditor}
            >
              <ChevronLeft size={13} />
              Routines
            </Button>
            <label
              htmlFor="local-routine-name"
              className="grid gap-1.5 text-[12px] text-muted-foreground"
            >
              Name
              <Input
                id="local-routine-name"
                value={name}
                disabled={managed}
                maxLength={80}
                placeholder="Morning brief"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label
              htmlFor="local-routine-prompt"
              className="grid gap-1.5 text-[12px] text-muted-foreground"
            >
              Prompt
              <Textarea
                id="local-routine-prompt"
                value={prompt}
                disabled={managed}
                rows={5}
                maxLength={100_000}
                placeholder="What should this bot do when the routine runs?"
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>
            <label
              htmlFor="local-routine-mode"
              className="grid gap-1.5 text-[12px] text-muted-foreground"
            >
              Schedule
              <select
                id="local-routine-mode"
                className="h-8 rounded-lg border border-border bg-input px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                value={mode}
                disabled={managed}
                onChange={(event) => setMode(event.target.value as ScheduleMode)}
              >
                {Object.entries(MODE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {mode === "once" ? (
              <label
                htmlFor="local-routine-run-at"
                className="grid gap-1.5 text-[12px] text-muted-foreground"
              >
                Run at
                <Input
                  id="local-routine-run-at"
                  type="datetime-local"
                  value={runAt}
                  disabled={managed}
                  onChange={(event) => setRunAt(event.target.value)}
                />
              </label>
            ) : mode === "custom" ? (
              <label
                htmlFor="local-routine-cron"
                className="grid gap-1.5 text-[12px] text-muted-foreground"
              >
                Cron expression
                <Input
                  id="local-routine-cron"
                  value={customCron}
                  disabled={managed}
                  placeholder="0 9 * * 1-5"
                  className="font-mono"
                  onChange={(event) => setCustomCron(event.target.value)}
                />
              </label>
            ) : (
              <label
                htmlFor="local-routine-time"
                className="grid gap-1.5 text-[12px] text-muted-foreground"
              >
                Time
                <Input
                  id="local-routine-time"
                  type="time"
                  value={time}
                  disabled={managed}
                  onChange={(event) => setTime(event.target.value)}
                />
              </label>
            )}
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                className="size-4 accent-foreground"
                checked={enabled}
                disabled={managed}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              Active
            </label>

            {editing ? (
              <section className="border-t border-border pt-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Recent runs
                  </h3>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={running}
                    onClick={() => void runNow()}
                  >
                    {running ? (
                      <LoaderCircle size={12} className="animate-spin" />
                    ) : (
                      <Play size={12} />
                    )}
                    Run now
                  </Button>
                </div>
                {history === null ? (
                  <Skeleton className="h-10 w-full" />
                ) : history.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">No runs yet.</p>
                ) : (
                  <div className="grid gap-1">
                    {history.map((run) => (
                      <div
                        key={run.id}
                        className="rounded-lg bg-muted/45 px-2.5 py-1.5 text-[11.5px] text-muted-foreground"
                      >
                        {runLabel(run)}
                        {run.error ? <p className="mt-0.5 text-destructive">{run.error}</p> : null}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {error ? (
              <p role="alert" className="text-[12.5px] text-destructive">
                {error}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
              {managed ? (
                <p className="text-[11.5px] text-muted-foreground">
                  Managed by your organization. Run it now or update the assigned preset on the
                  server.
                </p>
              ) : (
                <>
                  <Button type="button" disabled={!valid || saving} onClick={() => void save()}>
                    {saving ? <LoaderCircle size={13} className="animate-spin" /> : null}
                    {editingId === "new" ? "Create" : "Save"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={closeEditor}>
                    Cancel
                  </Button>
                  {editing ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="ms-auto text-destructive"
                      disabled={saving || running}
                      onClick={() => void remove()}
                    >
                      <Trash2 size={12} />
                      {confirmDelete ? "Confirm delete" : "Delete"}
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        )}

        {error && editingId === null ? (
          <p role="alert" className="text-[12.5px] text-destructive">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
