#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config as loadEnv } from "dotenv";

loadEnv({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });

async function main(): Promise<void> {
  const [{ GoogleRoutesClient }, { createServer }, { logger }] = await Promise.all([
    import("./google-routes/client.js"),
    import("./server.js"),
    import("./utils/logger.js"),
  ]);
  const server = createServer(new GoogleRoutesClient({ logger }));
  await server.connect(new StdioServerTransport());
  logger.info("MCP server started", { package: "@mymcp/google-routes", transport: "stdio" });
}

main().catch((error: unknown) => {
  process.stderr.write(`Fatal server error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
