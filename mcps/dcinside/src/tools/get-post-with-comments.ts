import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseDcPostUrl } from '../core/dc-url.js';
import { getPostWithCommentsInputSchema } from '../core/schemas.js';
import type { DcinsideService } from '../service/dcinside-service.js';
import { errorResult, successResult } from './result.js';

export function registerGetPostWithComments(server: McpServer, service: DcinsideService): void {
  server.registerTool(
    'dc_get_post_with_comments',
    {
      title: 'Get one post and its loaded comments',
      description:
        'Read one local or explicitly authorized post snapshot and return its post and comments without making duplicate remote requests.',
      inputSchema: getPostWithCommentsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ url, offset, limit, sourceMode }) => {
      try {
        const parsed = parseDcPostUrl(url);
        const post = await service.readParsed(parsed, sourceMode);
        if (!post) {
          return successResult({
            found: false,
            canonicalUrl: parsed.canonicalUrl,
            source: sourceMode === 'local' ? 'local_store' : 'authorized_direct',
            reason: sourceMode === 'local' ? 'NOT_IMPORTED' : 'NOT_FOUND',
            comments: { loadedCount: 0, items: [], offset, limit, partial: false },
          });
        }
        const all = post.comments?.items ?? [];
        const items = all.slice(offset, offset + limit);
        return successResult({
          found: true,
          canonicalUrl: post.canonicalUrl,
          source: post.provenance.source,
          post: {
            galleryId: post.galleryId,
            galleryType: post.galleryType,
            postNo: post.postNo,
            title: post.title,
            bodyText: post.bodyText,
            contentAvailable: post.contentAvailable,
            ...(post.imageUrls ? { imageUrls: post.imageUrls } : {}),
            ...(post.metrics ? { metrics: post.metrics } : {}),
          },
          comments: {
            ...(post.comments?.total === undefined ? {} : { total: post.comments.total }),
            loadedCount: items.length,
            items,
            offset,
            limit,
            partial: post.comments?.partial ?? false,
            ...(offset + items.length < all.length ? { nextOffset: offset + items.length } : {}),
          },
          ...(post.provenance.source === 'user_import'
            ? { importedAt: post.provenance.capturedAt }
            : { fetchedAt: post.provenance.capturedAt }),
          provenance: post.provenance,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
