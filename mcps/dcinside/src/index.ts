#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config as loadEnv } from "dotenv";
import { DcinsideClient } from "./dcinside/client.js";
import { createServer } from "./server.js";
import { Logger } from "./utils/logger.js";

loadEnv({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });

async function main(): Promise<void> {
  const logger = new Logger();
  const server = createServer(new DcinsideClient({ logger }));
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("MCP server started", { package: "@mymcp/dcinside", transport: "stdio" });
}

main().catch((error: unknown) => {
  console.error("Fatal server error:", error);
  process.exitCode = 1;
});
