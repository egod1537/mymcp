import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseDcPostUrl } from '../core/dc-url.js';
import { getCommentsInputSchema } from '../core/schemas.js';
import type { PostStore } from '../store/post-store.js';
import { errorResult, successResult } from './result.js';

export function registerGetComments(server: McpServer, store: PostStore): void {
  server.registerTool(
    'dc_get_comments',
    {
      title: 'Get locally imported DCInside comments',
      description:
        'Retrieve only comments included in a user-imported local record, with pagination. There is never a network fallback.',
      inputSchema: getCommentsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ url, offset, limit }) => {
      try {
        const parsed = parseDcPostUrl(url);
        const record = await store.get(parsed.canonicalUrl);
        if (!record) {
          return successResult({
            found: false,
            source: 'local_store',
            canonicalUrl: parsed.canonicalUrl,
            reason: 'NOT_IMPORTED',
            hint: 'Use dc_import_post with content you have manually supplied.',
          });
        }
        return successResult({
          found: true,
          source: 'user_import',
          canonicalUrl: record.canonicalUrl,
          total: record.comments.length,
          offset,
          limit,
          comments: record.comments.slice(offset, offset + limit),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
