import type { LocalTool } from "./tools.js";

export interface LocalComputerObservation {
  frameId: string;
  capturedAt: string;
  width: number;
  height: number;
  mimeType: "image/png" | "image/jpeg";
  image: Uint8Array;
  cursor?: { x: number; y: number };
  activeWindow?: { id: string; title?: string };
}

export type LocalComputerAction =
  | {
      kind: "pointer";
      x: number;
      y: number;
      type: "click" | "move" | "down" | "up";
      button: "left" | "right";
    }
  | { kind: "clipboard"; text: string }
  | { kind: "key"; key: string; modifiers?: string[] }
  | { kind: "scroll"; direction: "up" | "down"; amount: number }
  | { kind: "wait"; ms: number }
  | { kind: "focus"; application: string; uri?: string };

export interface LocalComputerProvider {
  observe(signal?: AbortSignal): Promise<LocalComputerObservation>;
  act(input: {
    actions: LocalComputerAction[];
    observe: boolean;
    settleMs: number;
    signal?: AbortSignal;
  }): Promise<{ completed: number; observation?: LocalComputerObservation }>;
}

function coordinate(value: unknown, name: string): number {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100_000) {
    throw new Error(`${name} must be a non-negative coordinate`);
  }
  return parsed;
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function parseComputerActions(value: unknown): LocalComputerAction[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("computer_act requires at least one action");
  }
  if (value.length > 24) throw new Error("computer_act accepts at most 24 actions");
  const actions = value.flatMap((raw): LocalComputerAction[] => {
    if (!raw || typeof raw !== "object") throw new Error("Computer action must be an object");
    const action = raw as Record<string, unknown>;
    const kind = String(action.kind ?? "");
    if (kind === "click" || kind === "move" || kind === "down" || kind === "up") {
      const pointer: LocalComputerAction = {
        kind: "pointer",
        x: coordinate(action.x, "x"),
        y: coordinate(action.y, "y"),
        type: kind,
        button: action.button === "right" ? "right" : "left",
      };
      return action.double === true && kind === "click" ? [pointer, pointer] : [pointer];
    }
    if (kind === "type") return [{ kind: "clipboard", text: String(action.text ?? "") }];
    if (kind === "key") {
      return [
        {
          kind: "key",
          key: String(action.key ?? ""),
          ...(Array.isArray(action.modifiers) ? { modifiers: action.modifiers.map(String) } : {}),
        },
      ];
    }
    if (kind === "scroll") {
      return [
        {
          kind: "scroll",
          direction: action.direction === "up" ? "up" : "down",
          amount: bounded(action.amount, 1, 20, 3),
        },
      ];
    }
    if (kind === "wait") return [{ kind: "wait", ms: bounded(action.ms, 0, 5_000, 350) }];
    if (kind === "focus") {
      const application = String(action.application ?? "").trim();
      if (!application) throw new Error("Focus requires an application");
      return [
        {
          kind: "focus",
          application,
          ...(action.uri === undefined ? {} : { uri: String(action.uri) }),
        },
      ];
    }
    throw new Error(`Unsupported computer action ${kind || "(missing)"}`);
  });
  if (actions.length > 24) throw new Error("computer_act expands beyond 24 actions");
  return actions;
}

function observationResult(
  observation: LocalComputerObservation,
  note: string,
): {
  kind: "agent_tool_result";
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: "image/png" | "image/jpeg" }
  >;
  details: Record<string, unknown>;
} {
  const details = {
    frameId: observation.frameId,
    capturedAt: observation.capturedAt,
    width: observation.width,
    height: observation.height,
    cursor: observation.cursor,
    activeWindow: observation.activeWindow,
  };
  return {
    kind: "agent_tool_result",
    content: [
      { type: "text", text: `${note}\n${JSON.stringify(details)}` },
      {
        type: "image",
        data: Buffer.from(observation.image).toString("base64"),
        mimeType: observation.mimeType,
      },
    ],
    details,
  };
}

export function createLocalComputerTools(provider: LocalComputerProvider): LocalTool[] {
  return [
    {
      definition: {
        name: "computer_observe",
        readOnly: true,
        requiresApproval: false,
        description:
          "Capture the current screen of this computer. Observe before coordinate actions and whenever the screen may have changed.",
        inputSchema: { type: "object", properties: {} },
      },
      async execute({ signal }) {
        return observationResult(await provider.observe(signal), "computer observed");
      },
    },
    {
      definition: {
        name: "computer_act",
        requiresApproval: true,
        description:
          "Perform up to 24 ordered pointer, keyboard, scroll, wait, or app-focus actions on the local desktop and return the resulting screen.",
        inputSchema: {
          type: "object",
          properties: {
            actions: {
              type: "array",
              items: { type: "object" },
              minItems: 1,
              maxItems: 24,
            },
            observe: { type: "boolean" },
            settle_ms: { type: "number", minimum: 0, maximum: 5_000 },
          },
          required: ["actions"],
        },
      },
      async execute({ args, signal }) {
        const result = await provider.act({
          actions: parseComputerActions(args.actions),
          observe: args.observe !== false,
          settleMs: bounded(args.settle_ms, 0, 5_000, 350),
          signal,
        });
        return result.observation
          ? observationResult(
              result.observation,
              `completed ${result.completed} computer action${result.completed === 1 ? "" : "s"}`,
            )
          : { ok: true, completed: result.completed };
      },
    },
  ];
}
