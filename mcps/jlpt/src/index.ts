#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config as loadEnv } from "dotenv";

loadEnv({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });

async function main(): Promise<void> {
  const [{ createServer }, { VocabStore }, { logger }] = await Promise.all([
    import("./server.js"),
    import("./vocab/store.js"),
    import("./utils/logger.js"),
  ]);
  const store = new VocabStore({ logger });
  const server = createServer(store);
  await server.connect(new StdioServerTransport());
  logger.info("MCP server started", { package: "@mymcp/japanese-vocab", transport: "stdio" });
}

main().catch((error: unknown) => {
  process.stderr.write(`Fatal server error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
