import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { importPostHtmlInputSchema } from '../core/schemas.js';
import { parseDcPostUrl } from '../core/dc-url.js';
import { DomainError } from '../errors.js';
import { parseUserPostHtml } from '../import/post-html.js';
import type { PostStore } from '../store/post-store.js';
import { createImportedRecord } from './import-post.js';
import { errorResult, successResult } from './result.js';

export function registerImportPostHtml(server: McpServer, store: PostStore, now: () => Date): void {
  server.registerTool(
    'dc_import_post_html',
    {
      title: 'Import user-supplied DCInside post HTML',
      description:
        'Parse one HTML page supplied directly by the user, sanitize it to plain text, and save it locally. The server never fetches the URL.',
      inputSchema: importPostHtmlInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ url, html, note }) => {
      try {
        const parsed = parseUserPostHtml(url, html, note);
        const existing = await store.get(parseDcPostUrl(url).canonicalUrl);
        if (existing) {
          throw new DomainError(
            'INPUT_INVALID',
            'Existing content is protected; use dc_import_post for an explicit replacement.',
            false,
          );
        }
        const record = {
          ...createImportedRecord(parsed.input, now),
          ...(parsed.imageUrls.length ? { imageUrls: parsed.imageUrls } : {}),
          parserVersion: parsed.parserVersion,
        };
        await store.save(record);
        return successResult({
          status: 'saved',
          source: 'user_import',
          canonicalUrl: record.canonicalUrl,
          bodyLength: record.bodyText.length,
          commentCount: record.comments.length,
          importedAt: record.importedAt,
          parserVersion: parsed.parserVersion,
          imageCount: parsed.imageUrls.length,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
