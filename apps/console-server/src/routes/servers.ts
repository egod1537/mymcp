import type { FastifyInstance } from 'fastify';
import {
  inspectRequestSchema,
  serverIdParamsSchema,
  type McpRegistryEntry,
  type ServerSummary,
} from '@mymcp/console-contracts';

import { HttpError } from '../http-error.js';
import { requireAuth, verifyCsrf, verifyOrigin } from '../security.js';
import type { ConsoleAppOptions } from '../types.js';
import { parseRequest } from '../validation.js';

const LIVE_STATUS_TTL_MS = 10_000;

function findEntry(options: ConsoleAppOptions, id: string): McpRegistryEntry {
  const entry = options.manager.listRegistry().find((candidate) => candidate.id === id);
  if (!entry) {
    throw new HttpError({
      statusCode: 404,
      code: 'SERVER_NOT_FOUND',
      message: 'MCP server is not registered.',
    });
  }
  return entry;
}

function summary(options: ConsoleAppOptions, entry: McpRegistryEntry): ServerSummary {
  const status = options.manager.getStatus(entry.id);
  const tools = options.manager.getCachedTools(entry.id);
  return {
    id: entry.id,
    displayName: entry.displayName,
    description: entry.description,
    catalogState: entry.catalogState,
    runtimeState: status.runtimeState,
    credentialState: status.credentialState,
    health: status.health,
    ...(tools ? { toolCount: tools.length } : {}),
    lastCheckedAt: status.lastCheckedAt,
    lastErrorCode: status.lastErrorCode,
  };
}

export async function registerServerRoutes(
  app: FastifyInstance,
  options: ConsoleAppOptions,
): Promise<void> {
  let liveRefresh: Promise<void> | null = null;
  let lastLiveRefreshAt = 0;
  const refreshSupportedServers = async (force = false): Promise<void> => {
    if (!force && Date.now() - lastLiveRefreshAt < LIVE_STATUS_TTL_MS) return;
    if (liveRefresh) return liveRefresh;
    liveRefresh = Promise.allSettled(
      options.manager
        .listRegistry()
        .filter(({ catalogState }) => catalogState === 'supported')
        .map(({ id }) => options.manager.inspect(id, { forceRefresh: true })),
    )
      .then(() => {
        lastLiveRefreshAt = Date.now();
      })
      .finally(() => {
        liveRefresh = null;
      });
    return liveRefresh;
  };

  app.get('/api/servers', async (request) => {
    await requireAuth(request, options.auth);
    await refreshSupportedServers();
    return {
      apiVersion: 1 as const,
      servers: options.manager.listRegistry().map((entry) => summary(options, entry)),
    };
  });

  app.get('/api/servers/:serverId', async (request) => {
    await requireAuth(request, options.auth);
    const { serverId } = parseRequest(serverIdParamsSchema, request.params);
    const entry = findEntry(options, serverId);
    if (entry.catalogState === 'supported') {
      await options.manager.inspect(serverId, { forceRefresh: true }).catch(() => undefined);
    }
    const status = options.manager.getStatus(serverId);
    return {
      apiVersion: 1 as const,
      server: {
        ...summary(options, entry),
        requiredBuildPackage: entry.requiredBuildPackage,
        ...(entry.expectedTools ? { expectedTools: entry.expectedTools } : {}),
        supportsWriteTools: entry.supportsWriteTools ?? false,
        transport: entry.transport,
        launchByDefault: entry.launchByDefault,
        environmentPresence: Object.fromEntries(
          entry.permittedEnvironmentKeys.map((key) => [key, Boolean(process.env[key])]),
        ),
        uptimeSince: status.uptimeSince,
        pid: status.pid,
        nextRetryAt: status.nextRetryAt,
      },
    };
  });

  app.get('/api/servers/:serverId/diagnostics', async (request) => {
    await requireAuth(request, options.auth);
    const { serverId } = parseRequest(serverIdParamsSchema, request.params);
    findEntry(options, serverId);
    return {
      apiVersion: 1 as const,
      serverId,
      stderr: options.manager.getStderr(serverId),
    };
  });

  app.post(
    '/api/servers/:serverId/inspect',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      verifyOrigin(request, options.allowedOrigin);
      const session = await requireAuth(request, options.auth);
      verifyCsrf(request, session);
      const { serverId } = parseRequest(serverIdParamsSchema, request.params);
      findEntry(options, serverId);
      const body = parseRequest(inspectRequestSchema, request.body ?? {});
      const inspection = await options.manager.inspect(
        serverId,
        body.forceRefresh === undefined ? {} : { forceRefresh: body.forceRefresh },
      );
      return {
        apiVersion: 1 as const,
        status: {
          id: serverId,
          catalogState: findEntry(options, serverId).catalogState,
          runtimeState: inspection.status.runtimeState,
          credentialState: inspection.status.credentialState,
          health: inspection.status.health,
          lastCheckedAt: inspection.status.lastCheckedAt,
          lastErrorCode: inspection.status.lastErrorCode,
          uptimeSince: inspection.status.uptimeSince,
        },
        tools: inspection.tools,
        checkedAt: new Date().toISOString(),
      };
    },
  );
}

export { findEntry };
