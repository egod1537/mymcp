import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { LocationResolver } from './tools/resolve-location.js';
import type { RouteGetter } from './tools/get-route.js';
import { resolveLocationInputSchema } from './schemas/location.js';
import { getRouteInputSchema } from './schemas/route.js';
import { toPublicError } from './lib/errors.js';

export interface GoogleMapsServerDependencies {
  locationResolver: LocationResolver;
  routeGetter: RouteGetter;
}

function jsonContent(value: unknown): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: JSON.stringify(value) }];
}

export const resolveLocationToolConfig = {
  title: 'Resolve a Google Maps location',
  description:
    'Resolve an unstructured place name or address into up to five Google candidates. Do not silently choose when needs_disambiguation is true. Use the selected Place ID with get_route.',
  inputSchema: resolveLocationInputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
} as const;

export const getRouteToolConfig = {
  title: 'Get a Google Maps route',
  description:
    'Compute a Google route between identified endpoints. Resolve unstructured place names with resolve_location first. Results are provider estimates and transit, walking, or bicycling details can be unavailable or carry warnings.',
  inputSchema: getRouteInputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
} as const;

export function createGoogleMapsToolHandlers(dependencies: GoogleMapsServerDependencies) {
  return {
    resolveLocation: async (input: unknown) => {
      try {
        const result = await dependencies.locationResolver.resolve(input);
        return { content: jsonContent(result) };
      } catch (error) {
        return { content: jsonContent(toPublicError(error)), isError: true };
      }
    },
    getRoute: async (input: unknown) => {
      try {
        const result = await dependencies.routeGetter.getRoute(input);
        return { content: jsonContent(result) };
      } catch (error) {
        return { content: jsonContent(toPublicError(error)), isError: true };
      }
    },
  };
}

export function createGoogleMapsServer(dependencies: GoogleMapsServerDependencies): McpServer {
  const server = new McpServer({
    name: '@mymcp/google-maps',
    version: '0.1.0',
  });

  const handlers = createGoogleMapsToolHandlers(dependencies);

  server.registerTool('resolve_location', resolveLocationToolConfig, handlers.resolveLocation);

  server.registerTool('get_route', getRouteToolConfig, handlers.getRoute);

  return server;
}
