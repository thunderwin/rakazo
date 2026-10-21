import type {
  Bot,
  LocalDatabase,
  ScratchpadStatus,
  TicketPriority,
  TicketStatus,
} from "@rakazo/local-db";
import type { LocalAgentTool } from "./agent.js";
import type {
  ApproveLocalTool,
  LocalToolExecutionRequest,
  LocalToolProvider,
} from "./tools.js";

const workTools: LocalAgentTool[] = [
  {
    name: "task_catalog",
    readOnly: true,
    requiresApproval: false,
    description:
      "Read this bot's real open scratchpad work, routines, skills, and currently exposed tools.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "scratchpad_list",
    readOnly: true,
    requiresApproval: false,
    description: "List this bot's open and parked scratchpad work.",
    inputSchema: {
      type: "object",
      properties: { includeDone: { type: "boolean" } },
    },
  },
  {
    name: "scratchpad_add",
    requiresApproval: false,
    description: "Add an open-work item that should outlive this turn.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        status: { type: "string", enum: ["open", "parked", "done"] },
        notes: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "scratchpad_update",
    requiresApproval: false,
    description: "Update a scratchpad item's title, status, or notes.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string" },
        title: { type: "string" },
        status: { type: "string", enum: ["open", "parked", "done"] },
        notes: { type: "string" },
      },
      required: ["itemId"],
    },
  },
  {
    name: "scratchpad_complete",
    requiresApproval: false,
    description: "Mark a scratchpad item done.",
    inputSchema: {
      type: "object",
      properties: { itemId: { type: "string" } },
      required: ["itemId"],
    },
  },
  {
    name: "scratchpad_remove",
    requiresApproval: true,
    description: "Permanently remove a scratchpad item.",
    inputSchema: {
      type: "object",
      properties: { itemId: { type: "string" } },
      required: ["itemId"],
    },
  },
  {
    name: "board_tickets",
    readOnly: true,
    requiresApproval: false,
    description:
      "List local tickets, optionally filtered by status or owner bot.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["todo", "doing", "review", "blocked", "done", "closed"],
        },
        ownerBotId: { type: "string" },
        cursor: { type: "string" },
      },
    },
  },
  {
    name: "ticket_get",
    readOnly: true,
    requiresApproval: false,
    description: "Read a ticket and its comments by reference or id.",
    inputSchema: {
      type: "object",
      properties: { ref: { type: "string" } },
      required: ["ref"],
    },
  },
  {
    name: "ticket_create",
    requiresApproval: false,
    description: "Create a local ticket. Owner defaults to this bot.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        ownerBotId: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "ticket_update",
    requiresApproval: false,
    description:
      "Update a ticket's title, description, priority, status, or owner.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        status: {
          type: "string",
          enum: ["todo", "doing", "review", "blocked", "done", "closed"],
        },
        ownerBotId: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "ticket_comment",
    requiresApproval: false,
    description: "Add a comment to a local ticket.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, body: { type: "string" } },
      required: ["id", "body"],
    },
  },
];
const workWriteToolNames = new Set(
  workTools.filter((tool) => !tool.readOnly).map((tool) => tool.name),
);
const ticketToolNames = new Set([
  "board_tickets",
  "ticket_get",
  "ticket_create",
  "ticket_update",
  "ticket_comment",
]);

function requiredString(
  args: Record<string, unknown>,
  key: string,
  max = 20_000,
): string {
  const value = typeof args[key] === "string" ? args[key].trim() : "";
  if (!value || value.length > max) throw new Error(`${key} is invalid`);
  return value;
}

function optionalString(
  args: Record<string, unknown>,
  key: string,
  max = 20_000,
): string | undefined {
  if (args[key] === undefined) return undefined;
  if (typeof args[key] !== "string" || args[key].length > max) {
    throw new Error(`${key} is invalid`);
  }
  return args[key];
}

export class LocalWorkToolProvider implements LocalToolProvider {
  private currentTools: LocalAgentTool[] = [];

  constructor(
    private readonly tools: LocalToolProvider,
    private readonly db: LocalDatabase,
    private readonly approve: ApproveLocalTool = () => false,
    private readonly enableTickets = false,
  ) {}

  async definitionsFor(bot: Bot): Promise<LocalAgentTool[]> {
    const inherited = await this.tools.definitionsFor(bot);
    const disabled = new Set(bot.disabledBuiltinTools);
    const availableWorkTools = this.enableTickets
      ? workTools
      : workTools.filter((tool) => !ticketToolNames.has(tool.name));
    this.currentTools = [
      ...inherited.filter(
        (tool) => !workTools.some((item) => item.name === tool.name),
      ),
      ...availableWorkTools.filter((tool) => !disabled.has(tool.name)),
    ];
    return this.currentTools;
  }

  async execute(request: LocalToolExecutionRequest): Promise<unknown> {
    if (!workTools.some((tool) => tool.name === request.name)) {
      return this.tools.execute(request);
    }
    if (!this.enableTickets && ticketToolNames.has(request.name)) {
      throw new Error(`Tool ${request.name} is not available`);
    }
    if (!request.botId) throw new Error(`${request.name} requires a bot`);
    if (
      workWriteToolNames.has(request.name) &&
      !(await this.approve(request))
    ) {
      throw new Error(`Tool ${request.name} was not approved`);
    }
    const args = request.args;
    if (request.name === "task_catalog") {
      return {
        scratchpad: this.db.work.listScratchpad(request.botId),
        routines: this.db.routines.list(request.botId),
        skills: this.db.skills.list().map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          source: skill.source,
        })),
        tools: this.currentTools.map((tool) => tool.name),
      };
    }
    if (request.name === "scratchpad_list") {
      return {
        items: this.db.work.listScratchpad(
          request.botId,
          args.includeDone === true,
        ),
      };
    }
    if (request.name === "scratchpad_add") {
      return this.db.work.addScratchpad({
        botId: request.botId,
        title: requiredString(args, "title", 500),
        ...(args.status === undefined
          ? {}
          : { status: args.status as ScratchpadStatus }),
        ...(optionalString(args, "notes", 20_000) === undefined
          ? {}
          : { notes: optionalString(args, "notes", 20_000)! }),
      });
    }
    if (request.name === "scratchpad_update") {
      return this.db.work.updateScratchpad(
        requiredString(args, "itemId", 200),
        request.botId,
        {
          ...(optionalString(args, "title", 500) === undefined
            ? {}
            : { title: optionalString(args, "title", 500)! }),
          ...(args.status === undefined
            ? {}
            : { status: args.status as ScratchpadStatus }),
          ...(optionalString(args, "notes", 20_000) === undefined
            ? {}
            : { notes: optionalString(args, "notes", 20_000)! }),
        },
      );
    }
    if (request.name === "scratchpad_complete") {
      return {
        ok: Boolean(
          this.db.work.updateScratchpad(
            requiredString(args, "itemId", 200),
            request.botId,
            {
              status: "done",
            },
          ),
        ),
      };
    }
    if (request.name === "scratchpad_remove") {
      return {
        removed: this.db.work.removeScratchpad(
          requiredString(args, "itemId", 200),
          request.botId,
        ),
      };
    }
    if (request.name === "board_tickets") {
      const cursor = optionalString(args, "cursor", 200);
      const beforeSequence = cursor ? Number(parseInt(cursor, 10)) : undefined;
      const tickets = this.db.work.listTickets({
        ...(args.status === undefined
          ? {}
          : { status: args.status as TicketStatus }),
        ...(args.ownerBotId === undefined
          ? {}
          : { ownerBotId: String(args.ownerBotId) }),
        ...(beforeSequence && Number.isInteger(beforeSequence)
          ? { beforeSequence }
          : {}),
      });
      return {
        tickets,
        nextCursor:
          tickets.length === 50
            ? String(tickets[tickets.length - 1]!.sequence)
            : null,
      };
    }
    if (request.name === "ticket_get") {
      return (
        this.db.work.getTicket(requiredString(args, "ref", 200)) ?? {
          error: "Ticket not found",
        }
      );
    }
    if (request.name === "ticket_create") {
      return this.db.work.createTicket({
        botId: request.botId,
        title: requiredString(args, "title", 500),
        ...(optionalString(args, "description", 20_000) === undefined
          ? {}
          : { description: optionalString(args, "description", 20_000)! }),
        ...(args.priority === undefined
          ? {}
          : { priority: args.priority as TicketPriority }),
        ...(args.ownerBotId === undefined
          ? {}
          : { ownerBotId: String(args.ownerBotId) }),
      });
    }
    if (request.name === "ticket_update") {
      return this.db.work.updateTicket(requiredString(args, "id", 200), {
        ...(optionalString(args, "title", 500) === undefined
          ? {}
          : { title: optionalString(args, "title", 500)! }),
        ...(optionalString(args, "description", 20_000) === undefined
          ? {}
          : { description: optionalString(args, "description", 20_000)! }),
        ...(args.priority === undefined
          ? {}
          : { priority: args.priority as TicketPriority }),
        ...(args.status === undefined
          ? {}
          : { status: args.status as TicketStatus }),
        ...(args.ownerBotId === undefined
          ? {}
          : { ownerBotId: String(args.ownerBotId) }),
      });
    }
    return this.db.work.addComment(
      requiredString(args, "id", 200),
      request.botId,
      requiredString(args, "body", 20_000),
    );
  }
}
