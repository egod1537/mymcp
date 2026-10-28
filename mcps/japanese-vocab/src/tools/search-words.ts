import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VocabStore } from "../vocab/store.js";
import { searchWordsInputSchema, searchWordsOutputSchema } from "../utils/validation.js";

export function registerSearchWords(server: McpServer, store: VocabStore): void {
  server.registerTool("search_words", {
    title: "Search Japanese vocabulary",
    description: "Search the personal vocabulary database across Japanese spelling, reading, Korean meaning, nuance, source category, and source set. Limit the fields when the user asks for a specific kind of match.",
    inputSchema: searchWordsInputSchema.shape,
    outputSchema: searchWordsOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    const words = store.searchWords(input);
    const structuredContent = { words, total: words.length };
    return { content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }], structuredContent };
  });
}
