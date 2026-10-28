import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { searchPostsInputSchema } from '../core/schemas.js';
import type { DcinsideService } from '../service/dcinside-service.js';
import { errorResult, successResult } from './result.js';

export function registerSearchPosts(server: McpServer, service: DcinsideService): void {
  server.registerTool(
    'dc_search_posts',
    {
      title: 'Search indexed DCInside post links',
      description:
        'Search through the explicitly selected authorized direct provider, Brave index, or local imported index. No source is used as an automatic fallback.',
      inputSchema: searchPostsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const searched = await service.search(input);
        return successResult({
          query: input.query,
          provider: searched.provider,
          source:
            input.source === 'authorized'
              ? 'authorized_direct'
              : input.source === 'brave'
                ? 'search_index'
                : 'local_index',
          count: searched.results.length,
          coverageNote:
            input.source === 'authorized'
              ? 'Results come from the explicitly authorized dcinside.js direct-search provider and are limited by the configured allowlist and rate limit.'
              : input.source === 'brave'
                ? 'Results come from a third-party search index and may be stale, incomplete, or not chronological.'
                : 'Results come only from user-imported local search-result files and are not live.',
          results: searched.results,
          queryPlan: {
            requestedSource: input.source,
            sort: input.sort,
            maxPages: input.source === 'brave' ? input.maxPages : 0,
          },
          totalFetched: searched.totalFetched,
          truncated: searched.results.length >= input.limit,
          dataSource: searched.dataSource,
          ...(searched.reason ? { reason: searched.reason } : {}),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
