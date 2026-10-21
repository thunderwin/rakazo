import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Routine, RoutineRun, RoutineRunStatus, RoutineRunTrigger } from "../types.js";

interface RoutineRow {
  id: string;
  bot_id: string;
  name: string;
  prompt: string;
  cron: string;
  timezone: string;
  source: "local" | "managed";
  enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RoutineRunRow {
  id: string;
  routine_id: string;
  run_id: string | null;
  scheduled_for: string;
  trigger: RoutineRunTrigger;
  status: RoutineRunStatus;
  error: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

function routineRow(row: RoutineRow): Routine {
  return {
    id: row.id,
    botId: row.bot_id,
    name: row.name,
    prompt: row.prompt,
    cron: row.cron,
    timezone: row.timezone,
    source: row.source,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function routineRunRow(row: RoutineRunRow): RoutineRun {
  return {
    id: row.id,
    routineId: row.routine_id,
    runId: row.run_id,
    scheduledFor: row.scheduled_for,
    trigger: row.trigger,
    status: row.status,
    error: row.error,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  };
}

export class RoutineRepository {
  constructor(private readonly db: Database.Database) {}

  list(botId: string): Routine[] {
    return (
      this.db
        .prepare("SELECT * FROM routines WHERE bot_id = ? ORDER BY created_at ASC")
        .all(botId) as RoutineRow[]
    ).map(routineRow);
  }

  get(id: string): Routine | null {
    const row = this.db.prepare("SELECT * FROM routines WHERE id = ?").get(id) as
      | RoutineRow
      | undefined;
    return row ? routineRow(row) : null;
  }

  create(input: {
    botId: string;
    name: string;
    prompt: string;
    cron: string;
    timezone: string;
    enabled: boolean;
    nextRunAt: string | null;
  }): Routine {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO routines
          (id, bot_id, name, prompt, cron, timezone, source, enabled, next_run_at,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'local', ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.botId,
        input.name,
        input.prompt,
        input.cron,
        input.timezone,
        input.enabled ? 1 : 0,
        input.nextRunAt,
        now,
        now,
      );
    return this.get(id)!;
  }

  update(
    id: string,
    input: {
      name?: string;
      prompt?: string;
      cron?: string;
      timezone?: string;
      enabled?: boolean;
      nextRunAt?: string | null;
    },
  ): Routine | null {
    const existing = this.get(id);
    if (!existing) return null;
    const next = {
      name: input.name ?? existing.name,
      prompt: input.prompt ?? existing.prompt,
      cron: input.cron ?? existing.cron,
      timezone: input.timezone ?? existing.timezone,
      enabled: input.enabled ?? existing.enabled,
      nextRunAt: input.nextRunAt === undefined ? existing.nextRunAt : input.nextRunAt,
    };
    this.db
      .prepare(
        `UPDATE routines
         SET name = ?, prompt = ?, cron = ?, timezone = ?, enabled = ?,
             next_run_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.name,
        next.prompt,
        next.cron,
        next.timezone,
        next.enabled ? 1 : 0,
        next.nextRunAt,
        new Date().toISOString(),
        id,
      );
    return this.get(id);
  }

  remove(id: string): boolean {
    return this.db.prepare("DELETE FROM routines WHERE id = ?").run(id).changes > 0;
  }

  listDue(now: string): Routine[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM routines
           WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
           ORDER BY next_run_at ASC`,
        )
        .all(now) as RoutineRow[]
    ).map(routineRow);
  }

  initializeMissingNext(now: Date, next: (routine: Routine, from: Date) => string | null): void {
    for (const routine of this.db
      .prepare("SELECT * FROM routines WHERE enabled = 1 AND next_run_at IS NULL")
      .all() as RoutineRow[]) {
      const record = routineRow(routine);
      const nextRunAt = next(record, now);
      this.db
        .prepare("UPDATE routines SET next_run_at = ?, updated_at = ? WHERE id = ?")
        .run(nextRunAt, new Date().toISOString(), record.id);
    }
  }

  finishSchedule(input: {
    id: string;
    lastRunAt: string;
    nextRunAt: string | null;
    enabled?: boolean;
  }): void {
    this.db
      .prepare(
        `UPDATE routines
         SET last_run_at = ?, next_run_at = ?, enabled = COALESCE(?, enabled), updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.lastRunAt,
        input.nextRunAt,
        input.enabled === undefined ? null : input.enabled ? 1 : 0,
        new Date().toISOString(),
        input.id,
      );
  }

  startRun(input: {
    routineId: string;
    scheduledFor: string;
    trigger: RoutineRunTrigger;
    startedAt: string;
  }): RoutineRun | null {
    const id = randomUUID();
    try {
      this.db
        .prepare(
          `INSERT INTO routine_runs
            (id, routine_id, scheduled_for, trigger, status, started_at, created_at)
           VALUES (?, ?, ?, ?, 'running', ?, ?)`,
        )
        .run(
          id,
          input.routineId,
          input.scheduledFor,
          input.trigger,
          input.startedAt,
          input.startedAt,
        );
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("UNIQUE constraint failed") ||
          error.message.includes("routine_runs.routine_id, routine_runs.scheduled_for"))
      ) {
        return null;
      }
      throw error;
    }
    return this.getRun(id);
  }

  finishRun(
    id: string,
    input: {
      runId?: string | null;
      status: Exclude<RoutineRunStatus, "running">;
      error?: string | null;
      endedAt: string;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE routine_runs
         SET run_id = COALESCE(?, run_id), status = ?, error = ?, ended_at = ?
         WHERE id = ?`,
      )
      .run(input.runId ?? null, input.status, input.error ?? null, input.endedAt, id);
  }

  getRun(id: string): RoutineRun | null {
    const row = this.db.prepare("SELECT * FROM routine_runs WHERE id = ?").get(id) as
      | RoutineRunRow
      | undefined;
    return row ? routineRunRow(row) : null;
  }

  listRuns(routineId: string, limit = 20): RoutineRun[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM routine_runs
           WHERE routine_id = ?
           ORDER BY started_at DESC
           LIMIT ?`,
        )
        .all(routineId, Math.max(1, Math.min(limit, 100))) as RoutineRunRow[]
    ).map(routineRunRow);
  }

  failInterruptedRuns(endedAt: string): void {
    this.db
      .prepare(
        `UPDATE routine_runs
         SET status = 'failed', error = 'App closed before this run finished.', ended_at = ?
         WHERE status = 'running'`,
      )
      .run(endedAt);
  }
}
