import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VocabStore } from "../vocab/store.js";
import {
  distributionHistoryInputSchema,
  distributionHistoryOutputSchema,
} from "../utils/validation.js";

export function registerGetDistributionHistory(server: McpServer, store: VocabStore): void {
  server.registerTool("get_distribution_history", {
    title: "Get vocabulary distribution history",
    description: "Return vocabulary previously distributed in daily batches, grouped by local calendar date. Filter by date range, source category, or source set when reviewing study history.",
    inputSchema: distributionHistoryInputSchema.shape,
    outputSchema: distributionHistoryOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    const structuredContent = { items: store.getDistributionHistory(input) };
    return { content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }], structuredContent };
  });
}
