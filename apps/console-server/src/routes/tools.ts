import type { FastifyInstance } from 'fastify';
import { Ajv } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import {
  callToolRequestSchema,
  serverIdParamsSchema,
  toolParamsSchema,
} from '@mymcp/console-contracts';
import type { CallToolResponse, ToolDefinitionDto } from '@mymcp/console-contracts';
import { McpClientError } from '@mymcp/mcp-client';

import { HttpError } from '../http-error.js';
import { requireAuth, verifyCsrf, verifyOrigin } from '../security.js';
import type { ConsoleAppOptions } from '../types.js';
import { parseRequest } from '../validation.js';
import { findEntry } from './servers.js';

const ARGUMENT_LIMIT_BYTES = 256 * 1024;
const RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;
const ajvDraft7 = new Ajv({ allErrors: true, strict: false, logger: false });
const ajv2020 = new Ajv2020({ allErrors: true, strict: false, logger: false });

function cachedTools(options: ConsoleAppOptions, serverId: string): readonly ToolDefinitionDto[] {
  findEntry(options, serverId);
  const tools = options.manager.getCachedTools(serverId);
  if (!tools) {
    throw new HttpError({
      statusCode: 409,
      code: 'NOT_INSPECTED',
      message: 'Inspect this MCP server first.',
    });
  }
  return tools;
}

function findTool(
  options: ConsoleAppOptions,
  serverId: string,
  toolName: string,
): ToolDefinitionDto {
  const tool = cachedTools(options, serverId).find((candidate) => candidate.name === toolName);
  if (!tool) {
    throw new HttpError({
      statusCode: 404,
      code: 'TOOL_NOT_FOUND',
      message: 'Tool was not found in the discovered MCP tool list.',
    });
  }
  return tool;
}

export function validateArguments(tool: ToolDefinitionDto, args: Record<string, unknown>): void {
  const validate =
    tool.inputSchema.$schema === 'http://json-schema.org/draft-07/schema#'
      ? ajvDraft7.compile(tool.inputSchema)
      : ajv2020.compile(tool.inputSchema);
  if (!validate(args)) {
    throw new HttpError({
      statusCode: 400,
      code: 'INVALID_ARGUMENTS',
      message: 'Tool arguments do not satisfy the discovered input schema.',
      details: {
        issues: (validate.errors ?? []).map(({ instancePath, keyword, message, params }) => ({
          instancePath,
          keyword,
          message,
          params,
        })),
      },
    });
  }
}

function boundedResponse(response: CallToolResponse): CallToolResponse {
  if (Buffer.byteLength(JSON.stringify(response), 'utf8') <= RESPONSE_LIMIT_BYTES) return response;
  return {
    ...response,
    content: [
      {
        type: 'text',
        text: 'Result exceeded the 2 MiB Console response limit and was omitted.',
      },
    ],
    structuredContent: undefined,
    truncated: true,
  };
}

export async function registerToolRoutes(
  app: FastifyInstance,
  options: ConsoleAppOptions,
): Promise<void> {
  app.get('/api/servers/:serverId/tools', async (request) => {
    await requireAuth(request, options.auth);
    const { serverId } = parseRequest(serverIdParamsSchema, request.params);
    return { apiVersion: 1 as const, tools: cachedTools(options, serverId) };
  });

  app.get('/api/servers/:serverId/tools/:toolName', async (request) => {
    await requireAuth(request, options.auth);
    const { serverId, toolName } = parseRequest(toolParamsSchema, request.params);
    return { apiVersion: 1 as const, tool: findTool(options, serverId, toolName) };
  });

  app.post(
    '/api/servers/:serverId/tools/:toolName/call',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request) => {
      verifyOrigin(request, options.allowedOrigin);
      const session = await requireAuth(request, options.auth);
      verifyCsrf(request, session);
      const { serverId, toolName } = parseRequest(toolParamsSchema, request.params);
      const startedAt = new Date().toISOString();
      const started = performance.now();
      let requestBytes: number | null = null;
      const record = async (event: {
        outcome: 'success' | 'tool_error' | 'transport_error' | 'timeout' | 'rejected';
        errorCode: string | null;
        responseBytes: number | null;
        isMcpToolError: boolean | null;
      }): Promise<void> => {
        await options.observability
          ?.recordExecution?.({
            serverId,
            toolName,
            startedAt,
            durationMs: Math.max(0, Math.round(performance.now() - started)),
            requestBytes,
            requestId: request.id,
            ...event,
          })
          .catch((error: unknown) =>
            request.log.error({ err: error }, 'Execution event write failed'),
          );
      };

      try {
        const body = parseRequest(callToolRequestSchema, request.body);
        requestBytes = Buffer.byteLength(JSON.stringify(body.arguments), 'utf8');
        const tool = findTool(options, serverId, toolName);
        if (requestBytes > ARGUMENT_LIMIT_BYTES) {
          throw new HttpError({
            statusCode: 400,
            code: 'INVALID_ARGUMENTS',
            message: 'Tool arguments exceed the 256 KiB Console limit.',
          });
        }
        validateArguments(tool, body.arguments);

        const entry = findEntry(options, serverId);
        const requiresConfirmation =
          (entry.supportsWriteTools ?? false) && tool.annotations?.readOnlyHint !== true;
        if (requiresConfirmation && body.confirmWrite !== true) {
          throw new HttpError({
            statusCode: 403,
            code: 'WRITE_CONFIRMATION_REQUIRED',
            message: 'This tool requires explicit write confirmation.',
          });
        }

        const result = await options.manager.callTool(serverId, toolName, body.arguments, {
          requestId: request.id,
          ...(body.timeoutMs === undefined ? {} : { timeoutMs: body.timeoutMs }),
        });
        const response: CallToolResponse = boundedResponse({
          apiVersion: 1,
          requestId: result.requestId,
          serverId,
          toolName,
          outcome: result.status,
          isError: result.status === 'tool_error',
          durationMs: result.durationMs,
          content: result.content.filter(
            (item): item is Record<string, unknown> =>
              item !== null && typeof item === 'object' && !Array.isArray(item),
          ),
          ...(result.structuredContent === undefined
            ? {}
            : { structuredContent: result.structuredContent }),
          executedAt: new Date().toISOString(),
        });
        const responseBytes = Buffer.byteLength(JSON.stringify(response), 'utf8');
        await record({
          outcome: result.status,
          errorCode: result.status === 'tool_error' ? 'MCP_TOOL_ERROR' : null,
          responseBytes,
          isMcpToolError: result.status === 'tool_error',
        });
        return response;
      } catch (error) {
        const errorCode =
          error instanceof HttpError || error instanceof McpClientError
            ? error.code
            : 'INTERNAL_ERROR';
        await record({
          outcome:
            errorCode === 'MCP_TIMEOUT'
              ? 'timeout'
              : error instanceof HttpError
                ? 'rejected'
                : 'transport_error',
          errorCode,
          responseBytes: null,
          isMcpToolError: false,
        });
        throw error;
      }
    },
  );
}
