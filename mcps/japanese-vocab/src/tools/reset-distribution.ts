import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VocabStore } from "../vocab/store.js";
import { resetDistributionInputSchema, resetDistributionOutputSchema } from "../utils/validation.js";

export function registerResetDistribution(server: McpServer, store: VocabStore): void {
  server.registerTool("reset_distribution", {
    title: "Reset vocabulary distribution state",
    description: "Reset selected distributed words to unseen so they can be distributed again. Use only when the user explicitly asks to reset distribution state. all=true resets every distributed word and must never be inferred or called automatically; it cannot be combined with narrower filters.",
    inputSchema: resetDistributionInputSchema.shape,
    outputSchema: resetDistributionOutputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    const structuredContent = { resetCount: store.resetDistribution(input) };
    return { content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }], structuredContent };
  });
}
