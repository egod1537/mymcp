import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createGoogleMapsServer } from '../../src/server.js';

const server = createGoogleMapsServer({
  locationResolver: {
    resolve: async () => ({
      status: 'no_results' as const,
      query: 'mock',
      query_type: 'place' as const,
      source: 'google_places_text_search' as const,
      candidates: [],
      needs_disambiguation: false,
      attribution: 'Google Maps' as const,
    }),
  },
  routeGetter: {
    getRoute: async () => ({
      status: 'no_route' as const,
      mode: 'WALK' as const,
      origin: { type: 'place_id' as const, place_id: 'mock-origin' },
      destination: { type: 'place_id' as const, place_id: 'mock-destination' },
      requested_departure_time: null,
      requested_arrival_time: null,
      routes: [],
      fallback_info: null,
      attribution: 'Google Maps' as const,
    }),
  },
});

await server.connect(new StdioServerTransport());
