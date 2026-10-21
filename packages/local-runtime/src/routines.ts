import {
  cronFromPreset,
  isOneShotRoutineCron,
  nextCronDate,
  ONCE_ROUTINE_CRON,
} from "@rakazo/core";
import type { Bot, LocalDatabase, Routine, RoutineRun, RoutineRunTrigger } from "@rakazo/local-db";
import type { LocalAgentTool } from "./agent.js";
import type { LocalToolExecutionRequest, LocalToolProvider } from "./tools.js";

export const ROUTINE_TOOL_NAMES = new Set(["schedule_create", "schedule_list", "schedule_cancel"]);

const SCHEDULER_INTERVAL_MS = 30_000;
const MISSED_GRACE_MS = 60_000;

const routineTools: LocalAgentTool[] = [
  {
    name: "schedule_create",
    requiresApproval: false,
    description:
      'Create a reminder or recurring job for this bot. Use for "remind me in 10 minutes" or "every morning send a joke". Repeats: cron or every/unit (min 1 minute). One-shot: runAt, delayMinutes, or delaySeconds.',
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        prompt: { type: "string" },
        timezone: { type: "string" },
        cron: { type: "string" },
        every: { type: "number" },
        unit: { type: "string", enum: ["minutes", "hours", "days"] },
        runAt: { type: "string" },
        delayMinutes: { type: "number" },
        delaySeconds: { type: "number" },
      },
      required: ["name", "prompt"],
    },
  },
  {
    name: "schedule_list",
    requiresApproval: false,
    description: "List this bot's active and inactive routines.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "schedule_cancel",
    requiresApproval: false,
    description: "Cancel a routine by routineId or exact name.",
    inputSchema: {
      type: "object",
      properties: {
        routineId: { type: "string" },
        name: { type: "string" },
      },
    },
  },
];

export interface LocalRoutineInput {
  name: string;
  prompt: string;
  cron: string;
  timezone?: string;
  enabled?: boolean;
  runAt?: string;
}

export type LocalRoutineUpdate = Partial<LocalRoutineInput>;

export interface LocalRoutineRuntimeOptions {
  db: LocalDatabase;
  runtime: {
    sendMessage(
      botId: string,
      text: string,
    ): Promise<{
      runId: string;
    }>;
  };
  now?: () => Date;
  defaultTimezone?: string;
}

function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function validTimezone(value: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    throw new Error("Routine timezone is invalid");
  }
}

function futureDate(value: string, label: string, from: Date): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} is invalid`);
  if (date.getTime() <= from.getTime()) throw new Error(`${label} must be in the future`);
  return date;
}

function scheduleError(cron: string, timezone: string, from: Date): void {
  if (!isOneShotRoutineCron(cron)) nextCronDate(cron, from, timezone);
}

function automatedPrompt(routine: Routine): string {
  return `Automated routine "${routine.name}". Complete this task now and report the useful result in this chat. It was triggered by the routine scheduler, not by a new user message.\n\n${routine.prompt}`;
}

export class LocalRoutineRuntime {
  private readonly now: () => Date;
  private readonly defaultTimezone: string;
  private readonly active = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: LocalRoutineRuntimeOptions) {
    this.now = options.now ?? (() => new Date());
    this.defaultTimezone = options.defaultTimezone ?? localTimezone();
  }

  list(botId: string): Routine[] {
    return this.options.db.routines.list(botId);
  }

  get(id: string): Routine | null {
    return this.options.db.routines.get(id);
  }

  history(routineId: string, limit = 20): RoutineRun[] {
    return this.options.db.routines.listRuns(routineId, limit);
  }

  create(botId: string, input: LocalRoutineInput): Routine {
    const name = input.name.trim();
    const prompt = input.prompt.trim();
    if (!name) throw new Error("Routine name is required");
    if (!prompt) throw new Error("Routine prompt is required");
    const timezone = validTimezone(input.timezone?.trim() || this.defaultTimezone);
    const cron = input.cron.trim();
    const now = this.now();
    scheduleError(cron, timezone, now);
    const enabled = input.enabled ?? true;
    const nextRunAt = this.nextRunAt(cron, timezone, now, input.runAt, enabled);
    return this.options.db.routines.create({
      botId,
      name,
      prompt,
      cron,
      timezone,
      enabled,
      nextRunAt,
    });
  }

  update(id: string, input: LocalRoutineUpdate): Routine {
    const existing = this.options.db.routines.get(id);
    if (!existing) throw new Error("Routine not found");
    if (existing.source === "managed") {
      throw new Error("This routine is managed by your organization");
    }
    const cron = input.cron?.trim() || existing.cron;
    const timezone = validTimezone(input.timezone?.trim() || existing.timezone);
    const enabled = input.enabled ?? existing.enabled;
    const now = this.now();
    scheduleError(cron, timezone, now);
    const shouldRecompute =
      cron !== existing.cron ||
      timezone !== existing.timezone ||
      input.runAt !== undefined ||
      (!existing.enabled && enabled);
    const nextRunAt = shouldRecompute
      ? this.nextRunAt(cron, timezone, now, input.runAt, enabled)
      : existing.nextRunAt;
    return this.options.db.routines.update(id, {
      name: input.name?.trim(),
      prompt: input.prompt?.trim(),
      cron,
      timezone,
      enabled,
      nextRunAt,
    })!;
  }

  remove(id: string): boolean {
    if (this.options.db.routines.get(id)?.source === "managed") {
      throw new Error("This routine is managed by your organization");
    }
    return this.options.db.routines.remove(id);
  }

  start(): void {
    if (this.timer) return;
    const now = this.now();
    this.options.db.routines.failInterruptedRuns(now.toISOString());
    this.options.db.routines.initializeMissingNext(now, (routine, from) =>
      isOneShotRoutineCron(routine.cron)
        ? routine.nextRunAt
        : nextCronDate(routine.cron, from, routine.timezone).toISOString(),
    );
    void this.tick();
    this.timer = setInterval(() => void this.tick(), SCHEDULER_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(at = this.now()): Promise<void> {
    const due = this.options.db.routines.listDue(at.toISOString());
    for (const routine of due) {
      if (this.active.has(routine.id)) continue;
      const scheduledFor = routine.nextRunAt ?? at.toISOString();
      const trigger: RoutineRunTrigger =
        new Date(scheduledFor).getTime() < at.getTime() - MISSED_GRACE_MS ? "missed" : "scheduled";
      await this.execute(routine.id, trigger, scheduledFor);
    }
  }

  async runNow(routineId: string): Promise<RoutineRun> {
    const at = this.now();
    return this.execute(routineId, "manual", at.toISOString());
  }

  private nextRunAt(
    cron: string,
    timezone: string,
    from: Date,
    runAt: string | undefined,
    enabled: boolean,
  ): string | null {
    if (isOneShotRoutineCron(cron)) {
      if (!runAt) {
        if (!enabled) return null;
        throw new Error("A one-time routine needs a run time");
      }
      return futureDate(runAt, "Routine run time", from).toISOString();
    }
    if (runAt) throw new Error("runAt is only valid for one-time routines");
    return enabled ? nextCronDate(cron, from, timezone).toISOString() : null;
  }

  private async execute(
    routineId: string,
    trigger: RoutineRunTrigger,
    scheduledFor: string,
  ): Promise<RoutineRun> {
    if (this.active.has(routineId)) throw new Error("Routine is already running");
    const routine = this.options.db.routines.get(routineId);
    if (!routine) throw new Error("Routine not found");
    const startedAt = this.now();
    const claim = this.options.db.routines.startRun({
      routineId,
      scheduledFor,
      trigger,
      startedAt: startedAt.toISOString(),
    });
    if (!claim) throw new Error("Routine run was already recorded");
    this.active.add(routineId);

    const oneShot = isOneShotRoutineCron(routine.cron);
    if (oneShot && trigger !== "manual") {
      this.options.db.routines.update(routine.id, { enabled: false, nextRunAt: null });
    }
    const nextRunAt =
      oneShot || trigger === "manual"
        ? routine.nextRunAt
        : nextCronDate(routine.cron, startedAt, routine.timezone).toISOString();

    try {
      const result = await this.options.runtime.sendMessage(
        routine.botId,
        automatedPrompt(routine),
      );
      const endedAt = this.now().toISOString();
      this.options.db.routines.finishRun(claim.id, {
        runId: result.runId,
        status: "completed",
        endedAt,
      });
      if (trigger !== "manual") {
        this.options.db.routines.finishSchedule({
          id: routine.id,
          lastRunAt: endedAt,
          nextRunAt: oneShot ? null : nextRunAt,
          ...(oneShot ? { enabled: false } : {}),
        });
      }
    } catch (error) {
      const endedAt = this.now().toISOString();
      this.options.db.routines.finishRun(claim.id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        endedAt,
      });
      if (trigger !== "manual") {
        this.options.db.routines.finishSchedule({
          id: routine.id,
          lastRunAt: endedAt,
          nextRunAt: oneShot ? null : nextRunAt,
          ...(oneShot ? { enabled: false } : {}),
        });
      }
    } finally {
      this.active.delete(routineId);
    }
    return this.options.db.routines.getRun(claim.id)!;
  }
}

export class LocalRoutineToolProvider implements LocalToolProvider {
  constructor(
    private readonly tools: LocalToolProvider,
    private readonly routines: () => LocalRoutineRuntime,
  ) {}

  definitionsFor(bot: Bot): LocalAgentTool[] {
    const disabled = new Set(bot.disabledBuiltinTools);
    return [
      ...this.tools.definitionsFor(bot).filter((tool) => !ROUTINE_TOOL_NAMES.has(tool.name)),
      ...routineTools.filter((tool) => !disabled.has(tool.name)),
    ];
  }

  async execute(request: LocalToolExecutionRequest): Promise<unknown> {
    if (request.name === "schedule_create") {
      if (!request.botId) throw new Error("schedule_create requires a bot");
      const schedule = scheduleFromArgs(request.args);
      return this.routines().create(request.botId, schedule);
    }
    if (request.name === "schedule_list") {
      if (!request.botId) throw new Error("schedule_list requires a bot");
      return this.routines().list(request.botId);
    }
    if (request.name === "schedule_cancel") {
      if (!request.botId) throw new Error("schedule_cancel requires a bot");
      const id =
        typeof request.args.routineId === "string" ? request.args.routineId.trim() : undefined;
      const name = typeof request.args.name === "string" ? request.args.name.trim() : undefined;
      const routines = this.routines();
      const matches = id
        ? routines.list(request.botId).filter((routine) => routine.id === id)
        : routines.list(request.botId).filter((routine) => routine.name === name);
      if (matches.length !== 1) {
        throw new Error(matches.length === 0 ? "Routine not found" : "Routine name is ambiguous");
      }
      return { ok: routines.remove(matches[0]!.id) };
    }
    return this.tools.execute(request);
  }
}

function scheduleFromArgs(args: Record<string, unknown>): LocalRoutineInput {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (!name || !prompt) throw new Error("name and prompt are required");
  const timezone = typeof args.timezone === "string" ? args.timezone.trim() : undefined;
  const cron = typeof args.cron === "string" ? args.cron.trim() : "";
  const every = typeof args.every === "number" ? args.every : undefined;
  const unit =
    args.unit === "minutes" || args.unit === "hours" || args.unit === "days"
      ? args.unit
      : undefined;
  const runAt =
    typeof args.runAt === "string"
      ? args.runAt
      : typeof args.delayMinutes === "number"
        ? new Date(Date.now() + args.delayMinutes * 60_000).toISOString()
        : typeof args.delaySeconds === "number"
          ? new Date(Date.now() + args.delaySeconds * 1_000).toISOString()
          : undefined;
  const oneShotMethods = [args.runAt, args.delayMinutes, args.delaySeconds].filter(
    (value) => value !== undefined,
  ).length;
  if (oneShotMethods > 1) {
    throw new Error("Use only one of runAt, delayMinutes, or delaySeconds");
  }
  const timingMethods = [Boolean(cron), every !== undefined, Boolean(runAt)].filter(Boolean).length;
  if (timingMethods !== 1) {
    throw new Error("Use exactly one timing method: cron, every/unit, or runAt/delay");
  }
  if (every !== undefined) {
    if (!unit || every < 1 || !Number.isFinite(every)) {
      throw new Error("every needs a positive unit");
    }
    return {
      name,
      prompt,
      cron: cronFromPreset({ freq: "Interval", n: every, unit }),
      ...(timezone ? { timezone } : {}),
    };
  }
  if (runAt) {
    return {
      name,
      prompt,
      cron: ONCE_ROUTINE_CRON,
      runAt,
      ...(timezone ? { timezone } : {}),
    };
  }
  return { name, prompt, cron, ...(timezone ? { timezone } : {}) };
}
