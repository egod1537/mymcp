import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { importSearchResultsInputSchema } from '../core/schemas.js';
import type { DcinsideService } from '../service/dcinside-service.js';
import { errorResult, successResult } from './result.js';

export function registerImportSearchResults(server: McpServer, service: DcinsideService): void {
  server.registerTool(
    'dc_import_search_results',
    {
      title: 'Import user-supplied DCInside search results',
      description:
        'Parse bounded CSV or JSON text supplied by the user and merge it into the private local search index. File paths and network URLs are never read.',
      inputSchema: importSearchResultsInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        return successResult(await service.importSearchResults(input));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
