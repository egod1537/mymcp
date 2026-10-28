import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { HttpError } from '../http-error.js';
import { requireAuth } from '../security.js';
import type { ConsoleAppOptions, ObservabilityReader } from '../types.js';
import { parseRequest } from '../validation.js';

const eventsQuerySchema = z
  .object({
    serverId: z.string().optional(),
    toolName: z.string().optional(),
    outcome: z.string().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    cursor: z.string().optional(),
    q: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

const metricsQuerySchema = z
  .object({
    range: z.enum(['24h', '7d', '30d']).default('24h'),
    serverId: z.string().optional(),
  })
  .strict();

const emptyReader: ObservabilityReader = {
  async listEvents() {
    return { events: [], nextCursor: null };
  },
  async getMetrics() {
    return {
      totalCalls: 0,
      successfulCalls: 0,
      toolErrors: 0,
      transportErrors: 0,
      timeouts: 0,
      rejectedCalls: 0,
      averageLatencyMs: null,
      medianLatencyMs: null,
      mostUsedTools: [],
      failuresByServer: [],
    };
  },
};

export async function registerEventRoutes(
  app: FastifyInstance,
  options: ConsoleAppOptions,
): Promise<void> {
  const reader = options.observability ?? emptyReader;
  app.get('/api/events', async (request) => {
    await requireAuth(request, options.auth);
    const query = parseRequest(eventsQuerySchema, request.query);
    let page;
    try {
      page = await reader.listEvents(query);
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_CURSOR') {
        throw new HttpError({
          statusCode: 400,
          code: 'VALIDATION_FAILED',
          message: 'Invalid event cursor.',
        });
      }
      throw error;
    }
    return {
      apiVersion: 1 as const,
      events: page.events,
      nextCursor: page.nextCursor,
    };
  });
  app.get('/api/metrics', async (request) => {
    await requireAuth(request, options.auth);
    const query = parseRequest(metricsQuerySchema, request.query);
    return {
      apiVersion: 1 as const,
      range: query.range,
      metrics: await reader.getMetrics(query.range, query.serverId),
    };
  });
}
