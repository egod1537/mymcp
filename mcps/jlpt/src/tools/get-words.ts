import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VocabStore } from "../vocab/store.js";
import { getWordsInputSchema, getWordsOutputSchema } from "../utils/validation.js";

export function registerGetWords(server: McpServer, store: VocabStore): void {
  server.registerTool("get_words", {
    title: "List stored Japanese vocabulary",
    description: "List stored vocabulary with optional source category, source set, and distribution-status filters. Use this for browsing a vocabulary set or selecting word IDs for flashcard generation.",
    inputSchema: getWordsInputSchema.shape,
    outputSchema: getWordsOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    const result = store.getWords(input);
    const structuredContent = { ...result };
    return { content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }], structuredContent };
  });
}
