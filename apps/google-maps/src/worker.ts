import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';

import { GeocodingClient } from './clients/geocoding.js';
import { FetchGoogleHttpClient } from './clients/google-http.js';
import { PlacesClient } from './clients/places.js';
import { RoutesClient } from './clients/routes.js';
import { loadConfig, type AppConfig, type EnvironmentSource } from './config.js';
import {
  createGoogleMapsToolHandlers,
  getRouteToolConfig,
  resolveLocationToolConfig,
  type GoogleMapsServerDependencies,
} from './server.js';
import { GoogleRouteGetter } from './tools/get-route.js';
import { GoogleLocationResolver } from './tools/resolve-location.js';

interface RateLimitResult {
  success: boolean;
}

interface RateLimiter {
  limit(options: { key: string }): Promise<RateLimitResult>;
}

export interface GoogleMapsWorkerEnv extends EnvironmentSource {
  GOOGLE_MAPS_API_KEY: string;
  MCP_RATE_LIMITER: RateLimiter;
}

interface CachedRuntime {
  configSignature: string;
  dependencies: GoogleMapsServerDependencies;
}

let cachedRuntime: CachedRuntime | undefined;

function configSignature(config: AppConfig): string {
  return JSON.stringify([
    config.apiKey,
    config.callsPerMinute,
    config.httpTimeoutMs,
    config.maxConcurrentCalls,
    config.maxRetries,
  ]);
}

function createDependencies(config: AppConfig): GoogleMapsServerDependencies {
  const http = new FetchGoogleHttpClient(config);
  return {
    locationResolver: new GoogleLocationResolver(new PlacesClient(http), new GeocodingClient(http)),
    routeGetter: new GoogleRouteGetter(new RoutesClient(http)),
  };
}

function getDependencies(env: GoogleMapsWorkerEnv): GoogleMapsServerDependencies {
  const config = loadConfig(env);
  const signature = configSignature(config);
  if (cachedRuntime?.configSignature !== signature) {
    cachedRuntime = {
      configSignature: signature,
      dependencies: createDependencies(config),
    };
  }
  return cachedRuntime.dependencies;
}

export function createGoogleMapsWorkerServer(env: GoogleMapsWorkerEnv): McpServer {
  const handlers = createGoogleMapsToolHandlers(getDependencies(env));
  const server = new McpServer(
    { name: '@mymcp/google-maps', version: '0.1.0' },
    {
      instructions:
        'Resolve ambiguous place names with resolve_location before routing. Never silently choose a candidate when needs_disambiguation is true. All results are read-only Google Maps data.',
    },
  );

  server.registerTool('resolve_location', resolveLocationToolConfig, handlers.resolveLocation);
  server.registerTool('get_route', getRouteToolConfig, handlers.getRoute);
  return server;
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

const worker = {
  async fetch(
    request: Request,
    env: GoogleMapsWorkerEnv,
    context: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/healthz')) {
      const configured = Boolean(env.GOOGLE_MAPS_API_KEY?.trim());
      return jsonResponse(
        { status: configured ? 'ok' : 'misconfigured', service: '@mymcp/google-maps' },
        configured ? 200 : 503,
      );
    }

    if (url.pathname !== '/mcp') {
      return jsonResponse({ error: 'not_found' }, 404);
    }

    if (!env.GOOGLE_MAPS_API_KEY?.trim()) {
      return jsonResponse({ error: 'service_unavailable' }, 503);
    }

    const rateLimit = await env.MCP_RATE_LIMITER.limit({ key: 'google-maps-mcp' });
    if (!rateLimit.success) {
      return jsonResponse({ error: 'rate_limited' }, 429);
    }

    const handler = createMcpHandler(() => createGoogleMapsWorkerServer(env), {
      route: '/mcp',
    });
    return handler(request, env, context);
  },
} satisfies ExportedHandler<GoogleMapsWorkerEnv>;

export default worker;
