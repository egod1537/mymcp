import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VocabStore } from "../vocab/store.js";
import { dailyWordsOutputSchema, getDailyWordsInputSchema } from "../utils/validation.js";

export function registerGetDailyWords(server: McpServer, store: VocabStore): void {
  server.registerTool("get_daily_words", {
    title: "Get the daily Japanese vocabulary batch",
    description: "Return the user's daily batch of previously undistributed Japanese vocabulary. By default returns 14 words, marks them distributed, and reuses today's existing batch when called again with the same count and source filters. Set forceNewBatch=true only when the user explicitly asks for a different set. markDistributed=false previews words without creating a batch.",
    inputSchema: getDailyWordsInputSchema.shape,
    outputSchema: dailyWordsOutputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input) => {
    const result = store.getDailyWords(input);
    store.logger.debug("daily batch returned", {
      batchId: result.batchId,
      returnedCount: result.returnedCount,
      reusedBatch: result.reusedBatch,
    });
    const structuredContent = { ...result };
    return { content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }], structuredContent };
  });
}
