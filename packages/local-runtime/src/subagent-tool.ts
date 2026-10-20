import type { LocalTool } from "./tools.js";

/** PiAgentRuntime handles this tool's nested loop; the registry only exposes its schema. */
export function createSubagentTool(): LocalTool {
  return {
    definition: {
      name: "run_subagent",
      requiresApproval: false,
      description:
        "Run a short-lived helper inside this turn only. It has no bot entry, thread, or computer of its own. Use it for parallel or isolated work whose result you will summarize.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          task: { type: "string" },
          instructions: { type: "string" },
          model_provider: { type: "string" },
          model_id: { type: "string" },
        },
        required: ["name", "task"],
      },
    },
    async execute() {
      throw new Error("run_subagent is executed by the Pi runtime");
    },
  };
}
