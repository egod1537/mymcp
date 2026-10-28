import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseDcPostUrl } from '../core/dc-url.js';
import { getPostInputSchema } from '../core/schemas.js';
import type { DcinsideService } from '../service/dcinside-service.js';
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

export function registerGetPost(server: McpServer, service: DcinsideService): void {
  server.registerTool(
    'dc_get_post',
    {
      title: 'Get a locally imported DCInside post',
      description:
        'Retrieve only post content previously supplied through dc_import_post. There is never a network fallback.',
      inputSchema: getPostInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ url, sourceMode, preferImages }) => {
      try {
        const parsed = parseDcPostUrl(url);
        const record = await service.readParsed(parsed, sourceMode);
        if (!record) {
          if (sourceMode === 'local') return successResult(notImported(parsed.canonicalUrl));
          return successResult({
            found: false,
            source: 'authorized_direct',
            canonicalUrl: parsed.canonicalUrl,
            reason: 'NOT_FOUND',
          });
        }
        return successResult({
          found: true,
          source: record.provenance.source,
          canonicalUrl: record.canonicalUrl,
          galleryId: record.galleryId,
          galleryType: record.galleryType,
          postNo: record.postNo,
          title: record.title,
          bodyText: record.bodyText,
          ...(record.note === undefined ? {} : { note: record.note }),
          contentAvailable: record.contentAvailable,
          ...(preferImages && record.imageUrls ? { imageUrls: record.imageUrls } : {}),
          ...(record.provenance.source === 'user_import'
            ? { importedAt: record.provenance.capturedAt }
            : { fetchedAt: record.provenance.capturedAt }),
          commentCount: record.comments?.items.length ?? 0,
          partial: record.comments?.partial ?? false,
          provenance: record.provenance,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
