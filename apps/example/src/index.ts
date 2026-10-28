#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createLogger } from '@mymcp/shared';

import { createExampleServer } from './server.js';

const logger = createLogger('@mymcp/example');
const server = createExampleServer();
let isClosing = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isClosing) {
    return;
  }

  isClosing = true;
  logger.info('Shutting down MCP server', { signal });

  try {
    await server.close();
  } catch (error) {
    logger.error('Failed to close MCP server', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('MCP server started', { transport: 'stdio' });
}

main().catch((error: unknown) => {
  logger.error('MCP server failed', {
    error: error instanceof Error ? error.message : 'Unknown error',
  });
  process.exitCode = 1;
});
