import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { VocabStore } from "../vocab/store.js";
import { importWordList } from "../vocab/importer.js";
import { importWordListInputSchema, importWordListOutputSchema } from "../utils/validation.js";

export function registerImportWordList(server: McpServer, store: VocabStore): void {
  server.registerTool("import_word_list", {
    title: "Import Japanese vocabulary",
    description: "Import a Japanese vocabulary list into the user's personal vocabulary pool. Use this when the user provides a new word list and wants it stored for later daily distribution. Accepts plain text, TSV, CSV, Markdown tables, and JSON. Preserves source category, source set, reading, Korean meaning, and nuance. Exact duplicates are skipped by default; conflicting meanings are reported and never silently overwritten.",
    inputSchema: importWordListInputSchema.shape,
    outputSchema: importWordListOutputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input) => {
    const result = importWordList(store, input);
    const structuredContent = { ...result };
    return { content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }], structuredContent };
  });
}
