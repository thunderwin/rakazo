import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { LocalMediaJob, LocalMediaJobKind, LocalMediaJobStatus } from "../types.js";

interface MediaJobRow {
  id: string;
  bot_id: string;
  group_id: string | null;
  run_id: string;
  execution_id: string;
  kind: LocalMediaJobKind;
  provider: string;
  provider_job_id: string | null;
  status: LocalMediaJobStatus;
  artifact_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToJob(row: MediaJobRow): LocalMediaJob {
  return {
    id: row.id,
    botId: row.bot_id,
    groupId: row.group_id,
    runId: row.run_id,
    executionId: row.execution_id,
    kind: row.kind,
    provider: row.provider,
    providerJobId: row.provider_job_id,
    status: row.status,
    artifactId: row.artifact_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class MediaJobRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: {
    botId: string;
    groupId?: string;
    runId: string;
    executionId: string;
    kind: LocalMediaJobKind;
    provider: string;
  }): LocalMediaJob {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO media_jobs
          (id, bot_id, group_id, run_id, execution_id, kind, provider,
           provider_job_id, status, artifact_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'queued', NULL, ?, ?)`,
      )
      .run(
        id,
        input.botId,
        input.groupId ?? null,
        input.runId,
        input.executionId,
        input.kind,
        input.provider,
        now,
        now,
      );
    return this.get(id)!;
  }

  get(id: string): LocalMediaJob | null {
    const row = this.db.prepare("SELECT * FROM media_jobs WHERE id = ?").get(id) as
      | MediaJobRow
      | undefined;
    return row ? rowToJob(row) : null;
  }

  findByExecution(runId: string, executionId: string): LocalMediaJob | null {
    const row = this.db
      .prepare("SELECT * FROM media_jobs WHERE run_id = ? AND execution_id = ?")
      .get(runId, executionId) as MediaJobRow | undefined;
    return row ? rowToJob(row) : null;
  }

  countForRun(runId: string, kind: LocalMediaJobKind): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS count FROM media_jobs WHERE run_id = ? AND kind = ?")
        .get(runId, kind) as { count: number }
    ).count;
  }

  update(
    id: string,
    input: {
      providerJobId?: string | null;
      status?: LocalMediaJobStatus;
      artifactId?: string | null;
    },
  ): LocalMediaJob | null {
    const current = this.get(id);
    if (!current) return null;
    this.db
      .prepare(
        `UPDATE media_jobs
         SET provider_job_id = ?, status = ?, artifact_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.providerJobId === undefined ? current.providerJobId : input.providerJobId,
        input.status ?? current.status,
        input.artifactId === undefined ? current.artifactId : input.artifactId,
        new Date().toISOString(),
        id,
      );
    return this.get(id);
  }
}
