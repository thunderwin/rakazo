import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  Bot,
  CreateGroupInput,
  GroupMember,
  LocalGroup,
  LocalGroupWithMembers,
} from "../types.js";
import { BotRepository } from "./bots.js";

interface GroupRow {
  id: string;
  name: string;
  description: string;
  color: string;
  source: "local" | "managed";
  managed_key: string | null;
  package_version: number | null;
  section: string | null;
  pinned: number;
  created_at: string;
  updated_at: string;
}

interface MemberRow {
  group_id: string;
  bot_id: string;
  position: number;
  created_at: string;
}

function rowToGroup(row: GroupRow): LocalGroup {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    source: row.source,
    managedKey: row.managed_key,
    packageVersion: row.package_version,
    section: row.section,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class GroupRepository {
  private readonly bots: BotRepository;

  constructor(private readonly db: Database.Database) {
    this.bots = new BotRepository(db);
  }

  create(input: CreateGroupInput): LocalGroupWithMembers {
    const name = input.name.trim();
    if (!name) throw new Error("Group name is required");
    const botIds = [...new Set(input.botIds)];
    if (botIds.length === 0) throw new Error("A group needs at least one bot");
    const now = new Date().toISOString();
    const id = randomUUID();
    return this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO chat_groups
            (id, name, description, color, section, pinned, source, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'local', ?, ?)`,
        )
        .run(
          id,
          name,
          input.description?.trim() ?? "",
          input.color ?? "violet",
          input.section ?? null,
          input.pinned ? 1 : 0,
          now,
          now,
        );
      this.replaceMembers(id, botIds, now);
      this.db
        .prepare(
          `INSERT INTO group_threads (id, group_id, title, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(randomUUID(), id, name, now, now);
      return this.get(id)!;
    })();
  }

  get(id: string): LocalGroupWithMembers | null {
    const row = this.db.prepare("SELECT * FROM chat_groups WHERE id = ?").get(id) as
      | GroupRow
      | undefined;
    if (!row) return null;
    return { ...rowToGroup(row), members: this.listMembers(id) };
  }

  list(): LocalGroupWithMembers[] {
    const rows = this.db
      .prepare("SELECT * FROM chat_groups ORDER BY pinned DESC, updated_at DESC, created_at ASC")
      .all() as GroupRow[];
    return rows.map((row) => ({ ...rowToGroup(row), members: this.listMembers(row.id) }));
  }

  update(
    id: string,
    input: {
      name?: string;
      description?: string;
      color?: string;
      botIds?: string[];
      section?: string | null;
      pinned?: boolean;
    },
  ): LocalGroupWithMembers | null {
    const current = this.get(id);
    if (!current) return null;
    const name = input.name === undefined ? current.name : input.name.trim();
    if (!name) throw new Error("Group name is required");
    const botIds =
      input.botIds === undefined
        ? current.members.map((member) => member.id)
        : [...new Set(input.botIds)];
    if (botIds.length === 0) throw new Error("A group needs at least one bot");
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE chat_groups
           SET name = ?, description = ?, color = ?, section = ?, pinned = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          name,
          input.description === undefined ? current.description : input.description.trim(),
          input.color ?? current.color,
          input.section === undefined ? (current.section ?? null) : input.section,
          input.pinned === undefined ? (current.pinned ? 1 : 0) : input.pinned ? 1 : 0,
          now,
          id,
        );
      if (input.botIds !== undefined) this.replaceMembers(id, botIds, now);
      this.db
        .prepare("UPDATE group_threads SET title = ?, updated_at = ? WHERE group_id = ?")
        .run(name, now, id);
    })();
    return this.get(id);
  }

  remove(id: string): boolean {
    return this.db.prepare("DELETE FROM chat_groups WHERE id = ?").run(id).changes > 0;
  }

  upsertManaged(input: {
    organizationId: string;
    key: string;
    packageVersion: number;
    name: string;
    description: string;
    color: string;
    botIds: string[];
  }): LocalGroupWithMembers {
    const managedKey = `${input.organizationId}:${input.key}`;
    const existing = this.db
      .prepare("SELECT * FROM chat_groups WHERE managed_key = ?")
      .get(managedKey) as GroupRow | undefined;
    const now = new Date().toISOString();
    if (!existing) {
      const id = randomUUID();
      return this.db.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO chat_groups
              (id, name, description, color, source, managed_key, package_version,
               created_at, updated_at)
             VALUES (?, ?, ?, ?, 'managed', ?, ?, ?, ?)`,
          )
          .run(
            id,
            input.name,
            input.description,
            input.color,
            managedKey,
            input.packageVersion,
            now,
            now,
          );
        this.replaceMembers(id, input.botIds, now);
        this.db
          .prepare(
            `INSERT INTO group_threads (id, group_id, title, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(randomUUID(), id, input.name, now, now);
        return this.get(id)!;
      })();
    }
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE chat_groups
           SET name = ?, description = ?, color = ?, package_version = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(input.name, input.description, input.color, input.packageVersion, now, existing.id);
      this.replaceMembers(existing.id, input.botIds, now);
      this.db
        .prepare("UPDATE group_threads SET title = ?, updated_at = ? WHERE group_id = ?")
        .run(input.name, now, existing.id);
    })();
    return this.get(existing.id)!;
  }

  deleteManagedExcept(organizationId: string, keepKeys: readonly string[]): number {
    const prefix = `${organizationId}:`;
    const keep = new Set(keepKeys.map((key) => `${prefix}${key}`));
    const rows = this.db
      .prepare(
        "SELECT id, managed_key FROM chat_groups WHERE source = 'managed' AND managed_key LIKE ?",
      )
      .all(`${prefix}%`) as Array<{ id: string; managed_key: string }>;
    const remove = this.db.prepare("DELETE FROM chat_groups WHERE id = ?");
    let count = 0;
    for (const row of rows) {
      if (keep.has(row.managed_key)) continue;
      count += remove.run(row.id).changes;
    }
    return count;
  }

  listMembers(groupId: string): Bot[] {
    const rows = this.db
      .prepare(
        `SELECT m.* FROM group_members m
         INNER JOIN bots b ON b.id = m.bot_id
         WHERE m.group_id = ?
         ORDER BY m.position ASC`,
      )
      .all(groupId) as MemberRow[];
    return rows.map((row) => this.bots.get(row.bot_id)).filter((bot): bot is Bot => bot !== null);
  }

  memberRecords(groupId: string): GroupMember[] {
    return (
      this.db
        .prepare("SELECT * FROM group_members WHERE group_id = ? ORDER BY position ASC")
        .all(groupId) as MemberRow[]
    ).map((row) => ({
      groupId: row.group_id,
      botId: row.bot_id,
      position: row.position,
      createdAt: row.created_at,
    }));
  }

  private replaceMembers(groupId: string, botIds: string[], createdAt: string) {
    for (const botId of botIds) {
      if (!this.bots.get(botId)) throw new Error(`Bot ${botId} does not exist`);
    }
    this.db.prepare("DELETE FROM group_members WHERE group_id = ?").run(groupId);
    const insert = this.db.prepare(
      `INSERT INTO group_members (group_id, bot_id, position, created_at)
       VALUES (?, ?, ?, ?)`,
    );
    for (const [position, botId] of botIds.entries()) {
      insert.run(groupId, botId, position, createdAt);
    }
  }
}
