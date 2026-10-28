#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { GeocodingClient } from './clients/geocoding.js';
import { FetchGoogleHttpClient } from './clients/google-http.js';
import { PlacesClient } from './clients/places.js';
import { RoutesClient } from './clients/routes.js';
import { loadConfig } from './config.js';
import { toGoogleMapsError } from './lib/errors.js';
import { createLogger } from './lib/logger.js';
import { createGoogleMapsServer } from './server.js';
import { GoogleRouteGetter } from './tools/get-route.js';
import { GoogleLocationResolver } from './tools/resolve-location.js';

export async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger('@mymcp/google-maps', config.logLevel);
  const http = new FetchGoogleHttpClient(config);
  const server = createGoogleMapsServer({
    locationResolver: new GoogleLocationResolver(new PlacesClient(http), new GeocodingClient(http)),
    routeGetter: new GoogleRouteGetter(new RoutesClient(http)),
  });
  let closing = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;
    logger.info('Shutting down MCP server', { signal });
    try {
      await server.close();
    } catch (error) {
      const safe = toGoogleMapsError(error);
      logger.error('Failed to close MCP server', { code: safe.code });
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await server.connect(new StdioServerTransport());
  logger.info('MCP server started', { transport: 'stdio' });
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  main().catch((error: unknown) => {
    const safe = toGoogleMapsError(error);
    const logger = createLogger('@mymcp/google-maps', 'info');
    logger.error('MCP server failed', { code: safe.code, error: safe.message });
    process.exitCode = 1;
  });
}
