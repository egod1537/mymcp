import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function echo(message: string): string {
  return message;
}

export function createExampleServer(): McpServer {
  const server = new McpServer({
    name: '@mymcp/example',
    version: '0.1.0',
  });

  server.registerTool(
    'echo',
    {
      title: 'Echo',
      description: 'Return the supplied message unchanged.',
      inputSchema: {
        message: z.string().describe('Text to return'),
      },
    },
    async ({ message }) => ({
      content: [
        {
          type: 'text',
          text: echo(message),
        },
      ],
    }),
  );

  return server;
}
