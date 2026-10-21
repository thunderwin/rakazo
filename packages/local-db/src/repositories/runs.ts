import type Database from "better-sqlite3";
import type {
  JsonValue,
  LocalActivityRun,
  LocalRunKind,
  LocalRunRecord,
  LocalRunStatus,
  LocalToolRunRecord,
  LocalToolRunStatus,
} from "../types.js";

interface RunRow {
  id: string;
  kind: LocalRunKind;
  bot_id: string;
  group_id: string | null;
  thread_id: string;
  status: LocalRunStatus;
  error: string | null;
  started_at: string;
  ended_at: string | null;
}

interface ToolRunRow {
  id: string;
  run_id: string;
  execution_id: string;
  bot_id: string;
  tool_name: string;
  arguments_json: string;
  result_json: string | null;
  status: LocalToolRunStatus;
  error: string | null;
  started_at: string;
  ended_at: string | null;
}

function runRow(row: RunRow): LocalRunRecord {
  return {
    id: row.id,
    kind: row.kind,
    botId: row.bot_id,
    groupId: row.group_id,
    threadId: row.thread_id,
    status: row.status,
    error: row.error,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

function toolRow(row: ToolRunRow): LocalToolRunRecord {
  return {
    id: row.id,
    runId: row.run_id,
    executionId: row.execution_id,
    botId: row.bot_id,
    toolName: row.tool_name,
    arguments: JSON.parse(row.arguments_json) as JsonValue,
    result: row.result_json ? (JSON.parse(row.result_json) as JsonValue) : null,
    status: row.status,
    error: row.error,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export class RunRepository {
  constructor(private readonly db: Database.Database) {}

  start(input: {
    id: string;
    kind: LocalRunKind;
    botId: string;
    groupId?: string | null;
    threadId: string;
  }): LocalRunRecord {
    const record: LocalRunRecord = {
      id: input.id,
      kind: input.kind,
      botId: input.botId,
      groupId: input.groupId ?? null,
      threadId: input.threadId,
      status: "running",
      error: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO runs
          (id, kind, bot_id, group_id, thread_id, status, error, started_at, ended_at)
         VALUES
          (@id, @kind, @botId, @groupId, @threadId, @status, @error, @startedAt, @endedAt)`,
      )
      .run(record);
    return record;
  }

  finish(id: string, status: Exclude<LocalRunStatus, "running">, error?: string | null): void {
    this.db
      .prepare(
        `UPDATE runs SET status = ?, error = ?, ended_at = ?
         WHERE id = ?`,
      )
      .run(status, error ?? null, new Date().toISOString(), id);
  }

  get(id: string): LocalRunRecord | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
    return row ? runRow(row) : null;
  }

  listRecent(limit = 30): LocalActivityRun[] {
    const rows = this.db
      .prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?")
      .all(Math.max(1, Math.min(limit, 200))) as RunRow[];
    return rows.map((row) => ({
      ...runRow(row),
      tools: this.listTools(row.id),
    }));
  }

  listTools(runId: string): LocalToolRunRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM tool_runs WHERE run_id = ? ORDER BY started_at ASC")
        .all(runId) as ToolRunRow[]
    ).map(toolRow);
  }

  startTool(input: {
    runId: string;
    executionId: string;
    botId: string;
    toolName: string;
    arguments: JsonValue;
  }): LocalToolRunRecord {
    const record: LocalToolRunRecord = {
      id: `${input.runId}:${input.executionId}`,
      runId: input.runId,
      executionId: input.executionId,
      botId: input.botId,
      toolName: input.toolName,
      arguments: input.arguments,
      result: null,
      status: "running",
      error: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO tool_runs
          (id, run_id, execution_id, bot_id, tool_name, arguments_json, result_json,
           status, error, started_at, ended_at)
         VALUES
          (@id, @runId, @executionId, @botId, @toolName, @argumentsJson, NULL,
           @status, @error, @startedAt, @endedAt)`,
      )
      .run({
        ...record,
        argumentsJson: JSON.stringify(record.arguments),
      });
    return record;
  }

  finishTool(
    runId: string,
    executionId: string,
    result: JsonValue | null,
    error?: string | null,
  ): void {
    this.db
      .prepare(
        `UPDATE tool_runs
         SET result_json = ?, status = ?, error = ?, ended_at = ?
         WHERE run_id = ? AND execution_id = ?`,
      )
      .run(
        result === null ? null : JSON.stringify(result),
        error ? "failed" : "completed",
        error ?? null,
        new Date().toISOString(),
        runId,
        executionId,
      );
  }
}
