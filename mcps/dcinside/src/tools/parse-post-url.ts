import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseDcPostUrl } from '../core/dc-url.js';
import { urlInputSchema } from '../core/schemas.js';
import { errorResult, successResult } from './result.js';

export function registerParsePostUrl(server: McpServer): void {
  server.registerTool(
    'dc_parse_post_url',
    {
      title: 'Parse a DCInside post URL',
      description:
        'Validate and canonicalize a supported DCInside post URL locally without making a network request.',
      inputSchema: urlInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ url }) => {
      try {
        return successResult({ valid: true, ...parseDcPostUrl(url), source: 'url_parse' });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
