#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config as loadEnv } from 'dotenv';
import { createServer } from './server.js';

loadEnv({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('@mymcp/dcinside MCP server started on stdio\n');
}

main().catch((error: unknown) => {
  console.error('Fatal server error:', error);
  process.exitCode = 1;
});
