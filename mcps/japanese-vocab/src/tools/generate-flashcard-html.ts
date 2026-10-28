import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VocabStore } from "../vocab/store.js";
import { generateFlashcardHtml } from "../flashcard/generator.js";
import { flashcardOutputSchema, generateFlashcardInputSchema } from "../utils/validation.js";

export function registerGenerateFlashcardHtml(server: McpServer, store: VocabStore): void {
  server.registerTool("generate_flashcard_html", {
    title: "Generate standalone Japanese flashcards",
    description: "Generate a standalone single-file Japanese flashcard HTML page from selected vocabulary. Use wordIds, a source filter, or directly supplied words. The page follows the established dark-theme mobile layout with always-visible nuance, hidden Korean and hiragana hints, shuffle, timer, bookmarks, speech, swipe actions, retry-unknown-first completion controls, and no external JavaScript framework.",
    inputSchema: generateFlashcardInputSchema.shape,
    outputSchema: flashcardOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    const result = generateFlashcardHtml(store, input);
    const structuredContent = { ...result };
    return {
      content: [{ type: "text", text: `Generated ${result.filename} with ${result.cardCount} cards. The standalone HTML is in structuredContent.html.` }],
      structuredContent,
    };
  });
}
