import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VocabStore } from "./vocab/store.js";
import { registerCreateDailyFlashcard } from "./tools/create-daily-flashcard.js";
import { registerGenerateFlashcardHtml } from "./tools/generate-flashcard-html.js";
import { registerGetDailyWords } from "./tools/get-daily-words.js";
import { registerGetDistributionHistory } from "./tools/get-distribution-history.js";
import { registerGetWords } from "./tools/get-words.js";
import { registerImportWordList } from "./tools/import-word-list.js";
import { registerResetDistribution } from "./tools/reset-distribution.js";
import { registerSearchWords } from "./tools/search-words.js";

export function createServer(store = new VocabStore()): McpServer {
  const server = new McpServer({
    name: "@mymcp/japanese-vocab",
    version: "0.1.0",
  }, {
    instructions: "Use import_word_list to preserve user-provided vocabulary and source metadata. Use get_daily_words or create_daily_flashcard for daily study; their default behavior reuses today's matching batch. Never call reset_distribution unless the user explicitly requests a reset, and never infer all=true. Treat the user's spelling, reading, Korean meaning, and nuance as the source of truth.",
  });

  registerImportWordList(server, store);
  registerGetDailyWords(server, store);
  registerGetWords(server, store);
  registerSearchWords(server, store);
  registerGetDistributionHistory(server, store);
  registerResetDistribution(server, store);
  registerGenerateFlashcardHtml(server, store);
  registerCreateDailyFlashcard(server, store);
  return server;
}
