import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseDcPostUrl } from '../core/dc-url.js';
import { urlInputSchema } from '../core/schemas.js';
import type { PostStore } from '../store/post-store.js';
import { errorResult, successResult } from './result.js';

function notImported(canonicalUrl: string) {
  return {
    found: false,
    source: 'local_store',
    canonicalUrl,
    reason: 'NOT_IMPORTED',
    hint: 'Use dc_import_post with content you have manually supplied.',
  } as const;
}

export function registerGetPost(server: McpServer, store: PostStore): void {
  server.registerTool(
    'dc_get_post',
    {
      title: 'Get a locally imported DCInside post',
      description:
        'Retrieve only post content previously supplied through dc_import_post. There is never a network fallback.',
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
        const parsed = parseDcPostUrl(url);
        const record = await store.get(parsed.canonicalUrl);
        if (!record) return successResult(notImported(parsed.canonicalUrl));
        return successResult({
          found: true,
          source: 'user_import',
          canonicalUrl: record.canonicalUrl,
          galleryId: record.galleryId,
          galleryType: record.galleryType,
          postNo: record.postNo,
          title: record.title,
          bodyText: record.bodyText,
          importedAt: record.importedAt,
          ...(record.note === undefined ? {} : { note: record.note }),
          commentCount: record.comments.length,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
