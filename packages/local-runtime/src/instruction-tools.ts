import type { LocalTool, LocalToolExecutionRequest } from "./tools.js";

export function createLocalInstructionProposalTool(
  propose: (request: LocalToolExecutionRequest) => Promise<unknown>,
): LocalTool {
  return {
    definition: {
      name: "propose_instructions_update",
      requiresApproval: true,
      description:
        "Propose replacement instructions for this bot with a reason. The owner must approve the exact new instructions before they are saved.",
      inputSchema: {
        type: "object",
        properties: {
          instructions: { type: "string", minLength: 1, maxLength: 40_000 },
          reason: { type: "string", minLength: 1, maxLength: 500 },
          expected_version: { type: "integer", minimum: 1 },
        },
        required: ["instructions", "reason"],
      },
    },
    execute: propose,
  };
}
