import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VocabStore } from "../vocab/store.js";
import { generateFlashcardHtml } from "../flashcard/generator.js";
import {
  createDailyFlashcardInputSchema,
  dailyFlashcardOutputSchema,
  ValidationError,
} from "../utils/validation.js";

export function registerCreateDailyFlashcard(server: McpServer, store: VocabStore): void {
  server.registerTool("create_daily_flashcard", {
    title: "Create today's Japanese flashcard",
    description: "Create or reuse today's vocabulary batch and generate a standalone flashcard HTML for it. Use this when the user wants today's study set as a ready-to-open flashcard page. Defaults to 14 words and reuses the same filtered batch on repeated calls; forceNewBatch=true is only for an explicit request for different words.",
    inputSchema: createDailyFlashcardInputSchema.shape,
    outputSchema: dailyFlashcardOutputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input) => {
    const daily = store.getDailyWords({
      ...(input.count !== undefined && { count: input.count }),
      ...(input.sourceCategory !== undefined && { sourceCategory: input.sourceCategory }),
      ...(input.sourceSet !== undefined && { sourceSet: input.sourceSet }),
      ...(input.excludeSourceSets !== undefined && { excludeSourceSets: input.excludeSourceSets }),
      ...(input.strategy !== undefined && { strategy: input.strategy }),
      ...(input.reuseToday !== undefined && { reuseToday: input.reuseToday }),
      ...(input.forceNewBatch !== undefined && { forceNewBatch: input.forceNewBatch }),
      markDistributed: true,
    });
    if (daily.words.length === 0) {
      throw new ValidationError("No unseen vocabulary matched the requested daily batch filters.");
    }
    const flashcard = generateFlashcardHtml(store, {
      wordIds: daily.words.map((word) => word.id),
      title: input.title ?? (input.sourceSet ? `${input.sourceSet}, 플래시카드` : undefined),
      shuffleOnStart: input.shuffleOnStart,
    });
    const structuredContent = {
      ...daily,
      ...flashcard,
      filename: `japanese-vocab-${daily.date}.html`,
    };
    return {
      content: [{ type: "text", text: `Prepared ${daily.returnedCount} daily words and generated ${structuredContent.filename}. The standalone HTML is in structuredContent.html.` }],
      structuredContent,
    };
  });
}
