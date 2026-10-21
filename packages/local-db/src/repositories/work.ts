import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  ScratchpadItem,
  ScratchpadStatus,
  Ticket,
  TicketComment,
  TicketPriority,
  TicketStatus,
} from "../types.js";

interface ScratchpadRow {
  id: string;
  bot_id: string;
  title: string;
  status: ScratchpadStatus;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface TicketRow {
  id: string;
  sequence: number;
  reference: string;
  bot_id: string;
  owner_bot_id: string | null;
  title: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  created_at: string;
  updated_at: string;
}

interface CommentRow {
  id: string;
  ticket_id: string;
  bot_id: string;
  body: string;
  created_at: string;
}

function scratchpadRow(row: ScratchpadRow): ScratchpadItem {
  return {
    id: row.id,
    botId: row.bot_id,
    title: row.title,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function commentRow(row: CommentRow): TicketComment {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    botId: row.bot_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

function ticketRow(row: TicketRow): Ticket {
  return {
    id: row.id,
    sequence: row.sequence,
    reference: row.reference,
    botId: row.bot_id,
    ownerBotId: row.owner_bot_id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class WorkRepository {
  constructor(private readonly db: Database.Database) {}

  listScratchpad(botId: string, includeDone = false): ScratchpadItem[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM scratchpad_items
           WHERE bot_id = ? ${includeDone ? "" : "AND status != 'done'"}
           ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'parked' THEN 1 ELSE 2 END,
                    updated_at DESC`,
        )
        .all(botId) as ScratchpadRow[]
    ).map(scratchpadRow);
  }

  addScratchpad(input: {
    botId: string;
    title: string;
    status?: ScratchpadStatus;
    notes?: string;
  }): ScratchpadItem {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO scratchpad_items
          (id, bot_id, title, status, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.botId, input.title, input.status ?? "open", input.notes ?? "", now, now);
    return this.getScratchpad(id)!;
  }

  getScratchpad(id: string): ScratchpadItem | null {
    const row = this.db.prepare("SELECT * FROM scratchpad_items WHERE id = ?").get(id) as
      | ScratchpadRow
      | undefined;
    return row ? scratchpadRow(row) : null;
  }

  updateScratchpad(
    id: string,
    botId: string,
    input: { title?: string; status?: ScratchpadStatus; notes?: string },
  ): ScratchpadItem | null {
    const current = this.getScratchpad(id);
    if (!current || current.botId !== botId) return null;
    this.db
      .prepare(
        `UPDATE scratchpad_items
         SET title = ?, status = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.title ?? current.title,
        input.status ?? current.status,
        input.notes ?? current.notes,
        new Date().toISOString(),
        id,
      );
    return this.getScratchpad(id);
  }

  removeScratchpad(id: string, botId: string): boolean {
    return (
      this.db.prepare("DELETE FROM scratchpad_items WHERE id = ? AND bot_id = ?").run(id, botId)
        .changes > 0
    );
  }

  listTickets(input: {
    status?: TicketStatus;
    ownerBotId?: string;
    beforeSequence?: number;
  }): Ticket[] {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (input.status) {
      clauses.push("status = ?");
      values.push(input.status);
    }
    if (input.ownerBotId) {
      clauses.push("owner_bot_id = ?");
      values.push(input.ownerBotId);
    }
    if (input.beforeSequence) {
      clauses.push("sequence < ?");
      values.push(input.beforeSequence);
    }
    return (
      this.db
        .prepare(
          `SELECT * FROM tickets
           ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
           ORDER BY sequence DESC LIMIT 51`,
        )
        .all(...values) as TicketRow[]
    )
      .slice(0, 50)
      .map(ticketRow);
  }

  getTicket(ref: string): Ticket | null {
    const row = this.db
      .prepare("SELECT * FROM tickets WHERE id = ? OR reference = ?")
      .get(ref, ref) as TicketRow | undefined;
    if (!row) return null;
    return { ...ticketRow(row), comments: this.comments(row.id) };
  }

  createTicket(input: {
    botId: string;
    ownerBotId?: string;
    title: string;
    description?: string;
    priority?: TicketPriority;
  }): Ticket {
    const now = new Date().toISOString();
    return this.db.transaction(() => {
      const sequence = (
        this.db.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM tickets").get() as {
          next: number;
        }
      ).next;
      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO tickets
            (id, sequence, reference, bot_id, owner_bot_id, title, description,
             priority, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?)`,
        )
        .run(
          id,
          sequence,
          `RAK-${sequence}`,
          input.botId,
          input.ownerBotId ?? input.botId,
          input.title,
          input.description ?? "",
          input.priority ?? "normal",
          now,
          now,
        );
      return this.getTicket(id)!;
    })();
  }

  updateTicket(
    id: string,
    input: {
      title?: string;
      description?: string;
      priority?: TicketPriority;
      status?: TicketStatus;
      ownerBotId?: string;
    },
  ): Ticket | null {
    const current = this.getTicket(id);
    if (!current) return null;
    this.db
      .prepare(
        `UPDATE tickets SET title = ?, description = ?, priority = ?, status = ?,
          owner_bot_id = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        input.title ?? current.title,
        input.description ?? current.description,
        input.priority ?? current.priority,
        input.status ?? current.status,
        input.ownerBotId ?? current.ownerBotId,
        new Date().toISOString(),
        id,
      );
    return this.getTicket(id);
  }

  addComment(ticketId: string, botId: string, body: string): TicketComment | null {
    if (!this.getTicket(ticketId)) return null;
    const comment: TicketComment = {
      id: randomUUID(),
      ticketId,
      botId,
      body,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        "INSERT INTO ticket_comments (id, ticket_id, bot_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(comment.id, ticketId, botId, body, comment.createdAt);
    return comment;
  }

  private comments(ticketId: string): TicketComment[] {
    return (
      this.db
        .prepare("SELECT * FROM ticket_comments WHERE ticket_id = ? ORDER BY created_at ASC")
        .all(ticketId) as CommentRow[]
    ).map(commentRow);
  }
}
