import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { searchPostsInputSchema } from '../core/schemas.js';
import type { SearchProvider } from '../providers/search-provider.js';
import { errorResult, successResult } from './result.js';

export function registerSearchPosts(server: McpServer, provider: SearchProvider): void {
  server.registerTool(
    'dc_search_posts',
    {
      title: 'Search indexed DCInside post links',
      description:
        "Search Brave's third-party web index for DCInside post links and snippets. This is not direct or live DCInside search and may be stale or incomplete.",
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
        const { results } = await provider.searchIndexedPosts(input);
        return successResult({
          query: input.query,
          provider: 'brave',
          source: 'search_index',
          count: results.length,
          coverageNote:
            'Results come from a third-party search index and may be stale, incomplete, or not chronological.',
          results,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
