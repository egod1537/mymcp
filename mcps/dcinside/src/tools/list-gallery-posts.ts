import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listGalleryPostsInputSchema } from '../core/schemas.js';
import type { DcinsideService } from '../service/dcinside-service.js';
import { errorResult, successResult } from './result.js';

export function registerListGalleryPosts(server: McpServer, service: DcinsideService): void {
  server.registerTool(
    'dc_list_gallery_posts',
    {
      title: 'List DCInside gallery posts from an explicit source',
      description:
        'List locally imported search results, or an explicitly authorized direct gallery page. Direct reads are disabled by default and never used as fallback.',
      inputSchema: listGalleryPostsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        return successResult(await service.listGallery(input));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
