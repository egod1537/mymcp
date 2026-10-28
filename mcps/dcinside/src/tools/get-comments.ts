import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseDcPostUrl } from '../core/dc-url.js';
import { getCommentsInputSchema } from '../core/schemas.js';
import type { DcinsideService } from '../service/dcinside-service.js';
import { errorResult, successResult } from './result.js';

export function registerGetComments(server: McpServer, service: DcinsideService): void {
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
    async ({ url, offset, limit, sourceMode }) => {
      try {
        const parsed = parseDcPostUrl(url);
        const record = await service.readParsed(parsed, sourceMode);
        if (!record) {
          return successResult({
            found: false,
            source: sourceMode === 'local' ? 'local_store' : 'authorized_direct',
            canonicalUrl: parsed.canonicalUrl,
            reason: 'NOT_IMPORTED',
            hint: 'Use dc_import_post with content you have manually supplied.',
          });
        }
        const comments = record.comments?.items ?? [];
        const loaded = comments.slice(offset, offset + limit);
        const total = record.comments?.total ?? comments.length;
        return successResult({
          found: true,
          source: record.provenance.source,
          canonicalUrl: record.canonicalUrl,
          total,
          offset,
          limit,
          comments: loaded,
          loadedCount: loaded.length,
          partial: record.comments?.partial ?? false,
          ...(offset + loaded.length < comments.length
            ? { nextOffset: offset + loaded.length }
            : {}),
          ...(record.provenance.source === 'authorized_direct'
            ? { fetchedAt: record.provenance.capturedAt }
            : {}),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
