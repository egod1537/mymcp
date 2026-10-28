import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseDcPostUrl } from '../core/dc-url.js';
import { importPostInputSchema, type ImportPostInput } from '../core/schemas.js';
import { sanitizeStoredText } from '../core/text.js';
import { DomainError } from '../errors.js';
import type { PostStore, StoredPostRecord } from '../store/post-store.js';
import { errorResult, successResult } from './result.js';

function optionalSanitized(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const sanitized = sanitizeStoredText(value);
  return sanitized.length === 0 ? undefined : sanitized;
}

export function createImportedRecord(input: ImportPostInput, now: () => Date): StoredPostRecord {
  const parsed = parseDcPostUrl(input.url);
  const title = sanitizeStoredText(input.title);
  const bodyText = sanitizeStoredText(input.bodyText);
  const comments = input.comments.map((comment) => ({
    text: sanitizeStoredText(comment.text),
    ...(optionalSanitized(comment.commentId) === undefined
      ? {}
      : { commentId: optionalSanitized(comment.commentId) }),
    ...(optionalSanitized(comment.postedAt) === undefined
      ? {}
      : { postedAt: optionalSanitized(comment.postedAt) }),
  }));
  if (title.trim().length === 0) {
    throw new DomainError(
      'INPUT_INVALID',
      'Title is empty after removing unsafe control characters.',
      false,
    );
  }
  if (comments.some((comment) => comment.text.trim().length === 0)) {
    throw new DomainError(
      'INPUT_INVALID',
      'A comment is empty after removing unsafe control characters.',
      false,
    );
  }
  if (bodyText.trim().length === 0 && comments.length === 0) {
    throw new DomainError(
      'INPUT_INVALID',
      'Provide nonempty bodyText or at least one comment.',
      false,
    );
  }
  const note = optionalSanitized(input.note);

  return {
    schemaVersion: 1,
    source: 'user_import',
    ...parsed,
    title,
    bodyText,
    comments,
    ...(note === undefined ? {} : { note }),
    importedAt: now().toISOString(),
  };
}

export function registerImportPost(server: McpServer, store: PostStore, now: () => Date): void {
  server.registerTool(
    'dc_import_post',
    {
      title: 'Import user-supplied DCInside post text',
      description:
        'Save post text and optional comments supplied explicitly by the user into private local storage. This tool never fetches the URL.',
      inputSchema: importPostInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const record = createImportedRecord(input, now);
        await store.save(record);
        return successResult({
          status: 'saved',
          canonicalUrl: record.canonicalUrl,
          galleryId: record.galleryId,
          postNo: record.postNo,
          importedAt: record.importedAt,
          bodyLength: record.bodyText.length,
          commentCount: record.comments.length,
          source: 'user_import',
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
