import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  runTestCasesRequestSchema,
  savedTestCaseInputSchema,
  savedTestCaseUpdateSchema,
  testCaseIdParamsSchema,
} from '@mymcp/console-contracts';
import type {
  SavedTestCase,
  SavedTestCaseInput,
  SavedTestRunResult,
  TestAssertion,
  TestAssertionResult,
  ToolDefinitionDto,
} from '@mymcp/console-contracts';
import { McpClientError } from '@mymcp/mcp-client';

import { HttpError } from '../http-error.js';
import { requireAuth, verifyCsrf, verifyOrigin } from '../security.js';
import type { ConsoleAppOptions, PersistedTestCaseInput } from '../types.js';
import { parseRequest } from '../validation.js';
import { findEntry } from './servers.js';
import { validateArguments } from './tools.js';

const listQuerySchema = z
  .object({
    serverId: z.string().optional(),
    q: z.string().max(200).optional(),
  })
  .strict();

const secretKeyPattern = /(?:password|passwd|secret|token|api[_-]?key|authorization|cookie)/iu;
const secretValuePattern = /(?:\$argon2id\$|\bBearer\s+[A-Za-z0-9._~-]+)/u;

function schemaHash(tool: ToolDefinitionDto): string {
  return createHash('sha256').update(JSON.stringify(tool.inputSchema)).digest('hex');
}

function detectedSecrets(value: unknown, path = ''): string[] {
  if (typeof value === 'string') return secretValuePattern.test(value) ? [path || '/'] : [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => detectedSecrets(item, `${path}/${index}`));
  }
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
    return secretKeyPattern.test(key) ? [childPath] : detectedSecrets(child, childPath);
  });
}

function persisted(input: SavedTestCaseInput): PersistedTestCaseInput {
  const { confirmSensitive: _confirmation, ...stored } = input;
  void _confirmation;
  return stored;
}

function discoveredTool(
  options: ConsoleAppOptions,
  serverId: string,
  toolName: string,
): ToolDefinitionDto {
  const entry = findEntry(options, serverId);
  if (entry.catalogState !== 'supported') {
    throw new HttpError({
      statusCode: 409,
      code: 'NOT_SUPPORTED',
      message: 'Saved tests require a supported registry entry.',
    });
  }
  const tools = options.manager.getCachedTools(serverId);
  if (!tools) {
    throw new HttpError({
      statusCode: 409,
      code: 'NOT_INSPECTED',
      message: 'Inspect this server before saving a test case.',
    });
  }
  const tool = tools.find((candidate) => candidate.name === toolName);
  if (!tool) {
    throw new HttpError({
      statusCode: 404,
      code: 'TOOL_NOT_FOUND',
      message: 'The saved-test tool is not in the discovered tool list.',
    });
  }
  return tool;
}

function validateSavedInput(input: SavedTestCaseInput, tool: ToolDefinitionDto): void {
  validateArguments(tool, input.arguments);
  const secretPaths = detectedSecrets(input.arguments);
  if (secretPaths.length > 0) {
    throw new HttpError({
      statusCode: 400,
      code: 'SENSITIVE_ARGUMENTS_DENIED',
      message: 'Secret-like arguments cannot be saved. Use runtime environment references.',
      details: { paths: secretPaths.slice(0, 20) },
    });
  }
  if (input.sensitiveData && input.confirmSensitive !== true) {
    throw new HttpError({
      statusCode: 403,
      code: 'SENSITIVE_ARGUMENTS_DENIED',
      message: 'Saving owner-provided sensitive data requires explicit confirmation.',
    });
  }
}

function pointer(root: unknown, path: string): { exists: boolean; value: unknown } {
  if (path === '') return { exists: true, value: root };
  let current = root;
  for (const raw of path.slice(1).split('/')) {
    const segment = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { exists: false, value: undefined };
      }
      current = current[index];
      continue;
    }
    if (current === null || typeof current !== 'object' || !(segment in current)) {
      return { exists: false, value: undefined };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { exists: true, value: current };
}

function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function evaluateAssertion(root: unknown, assertion: TestAssertion): TestAssertionResult {
  const selected = pointer(root, assertion.path);
  let passed = false;
  if (assertion.op === 'exists') passed = selected.exists;
  if (assertion.op === 'equals') {
    passed = selected.exists && isDeepStrictEqual(selected.value, assertion.expected);
  }
  if (assertion.op === 'type') {
    passed = selected.exists && valueType(selected.value) === assertion.expected;
  }
  if (assertion.op === 'contains') {
    passed =
      selected.exists &&
      ((typeof selected.value === 'string' &&
        typeof assertion.expected === 'string' &&
        selected.value.includes(assertion.expected)) ||
        (Array.isArray(selected.value) &&
          selected.value.some((item) => isDeepStrictEqual(item, assertion.expected))));
  }
  return {
    path: assertion.path,
    op: assertion.op,
    passed,
    message: passed ? 'Assertion passed.' : `Assertion ${assertion.op} failed.`,
  };
}

function comparisonTarget(result: {
  structuredContent?: unknown;
  content: readonly unknown[];
}): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content
    .filter(
      (item): item is Record<string, unknown> =>
        item !== null && typeof item === 'object' && !Array.isArray(item),
    )
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('\n');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function executeCase(
  options: ConsoleAppOptions,
  testCase: SavedTestCase,
  controls: { includeWriteTools: boolean; confirmWrite: boolean; confirmExternal: boolean },
): Promise<SavedTestRunResult> {
  const store = options.testCases!;
  if (!testCase.enabled) {
    return store.recordRun({
      testCaseId: testCase.id,
      status: 'skipped',
      durationMs: null,
      reason: 'Test case is disabled.',
      requestId: null,
      assertionResults: [],
    });
  }
  let tool: ToolDefinitionDto;
  try {
    tool = discoveredTool(options, testCase.serverId, testCase.toolName);
    validateArguments(tool, testCase.arguments);
  } catch (error) {
    return store.recordRun({
      testCaseId: testCase.id,
      status: 'errored',
      durationMs: null,
      reason: error instanceof HttpError ? error.code : 'VALIDATION_FAILED',
      requestId: null,
      assertionResults: [],
    });
  }
  const entry = findEntry(options, testCase.serverId);
  const writeRisk = (entry.supportsWriteTools ?? false) && tool.annotations?.readOnlyHint !== true;
  if (writeRisk && (!controls.includeWriteTools || !controls.confirmWrite)) {
    return store.recordRun({
      testCaseId: testCase.id,
      status: 'skipped',
      durationMs: null,
      reason: 'Write-capable tool requires explicit run opt-in and confirmation.',
      requestId: null,
      assertionResults: [],
    });
  }
  if (tool.annotations?.openWorldHint === true && !controls.confirmExternal) {
    return store.recordRun({
      testCaseId: testCase.id,
      status: 'skipped',
      durationMs: null,
      reason: 'External or quota-consuming tool requires explicit confirmation.',
      requestId: null,
      assertionResults: [],
    });
  }

  const requestId = randomUUID();
  const started = performance.now();
  try {
    const result = await options.manager.callTool(
      testCase.serverId,
      testCase.toolName,
      testCase.arguments,
      { requestId },
    );
    const durationMs = Math.max(0, Math.round(performance.now() - started));
    const isError = result.status === 'tool_error';
    const assertionResults = testCase.assertions.map((assertion) =>
      evaluateAssertion(comparisonTarget(result), assertion),
    );
    const expectedErrorMatches =
      testCase.expectedIsError === undefined || testCase.expectedIsError === isError;
    const passed = expectedErrorMatches && assertionResults.every((assertion) => assertion.passed);
    await options.observability?.recordExecution?.({
      serverId: testCase.serverId,
      toolName: testCase.toolName,
      startedAt: new Date(Date.now() - durationMs).toISOString(),
      durationMs,
      outcome: result.status,
      errorCode: isError ? 'MCP_TOOL_ERROR' : null,
      responseBytes: null,
      requestBytes: Buffer.byteLength(JSON.stringify(testCase.arguments), 'utf8'),
      isMcpToolError: isError,
      requestId,
    });
    return store.recordRun({
      testCaseId: testCase.id,
      status: passed ? 'passed' : 'failed',
      durationMs,
      reason: expectedErrorMatches ? null : `Expected isError=${String(testCase.expectedIsError)}.`,
      requestId,
      assertionResults,
    });
  } catch (error) {
    const durationMs = Math.max(0, Math.round(performance.now() - started));
    const code =
      error instanceof McpClientError || error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
    await options.observability?.recordExecution?.({
      serverId: testCase.serverId,
      toolName: testCase.toolName,
      startedAt: new Date(Date.now() - durationMs).toISOString(),
      durationMs,
      outcome: code === 'MCP_TIMEOUT' ? 'timeout' : 'transport_error',
      errorCode: code,
      responseBytes: null,
      requestBytes: Buffer.byteLength(JSON.stringify(testCase.arguments), 'utf8'),
      isMcpToolError: false,
      requestId,
    });
    return store.recordRun({
      testCaseId: testCase.id,
      status: 'errored',
      durationMs,
      reason: code,
      requestId,
      assertionResults: [],
    });
  }
}

export async function registerSavedTestRoutes(
  app: FastifyInstance,
  options: ConsoleAppOptions,
): Promise<void> {
  const store = options.testCases;
  if (!store) return;

  app.get('/api/test-cases', async (request) => {
    await requireAuth(request, options.auth);
    const query = parseRequest(listQuerySchema, request.query);
    return { apiVersion: 1 as const, testCases: await store.listCases(query) };
  });

  app.get('/api/test-cases/:testCaseId', async (request) => {
    await requireAuth(request, options.auth);
    const { testCaseId } = parseRequest(testCaseIdParamsSchema, request.params);
    const testCase = await store.getCase(testCaseId);
    if (!testCase) {
      throw new HttpError({
        statusCode: 404,
        code: 'TEST_CASE_NOT_FOUND',
        message: 'Saved test case was not found.',
      });
    }
    return { apiVersion: 1 as const, testCase };
  });

  app.post('/api/test-cases', async (request) => {
    verifyOrigin(request, options.allowedOrigin);
    const session = await requireAuth(request, options.auth);
    verifyCsrf(request, session);
    const input = parseRequest(savedTestCaseInputSchema, request.body);
    const tool = discoveredTool(options, input.serverId, input.toolName);
    validateSavedInput(input, tool);
    return {
      apiVersion: 1 as const,
      testCase: await store.createCase(persisted(input), schemaHash(tool)),
    };
  });

  app.put('/api/test-cases/:testCaseId', async (request) => {
    verifyOrigin(request, options.allowedOrigin);
    const session = await requireAuth(request, options.auth);
    verifyCsrf(request, session);
    const { testCaseId } = parseRequest(testCaseIdParamsSchema, request.params);
    const current = await store.getCase(testCaseId);
    if (!current) {
      throw new HttpError({
        statusCode: 404,
        code: 'TEST_CASE_NOT_FOUND',
        message: 'Saved test case was not found.',
      });
    }
    const update = parseRequest(savedTestCaseUpdateSchema, request.body);
    const input = parseRequest(savedTestCaseInputSchema, {
      name: current.name,
      description: current.description,
      serverId: current.serverId,
      toolName: current.toolName,
      arguments: current.arguments,
      expectedIsError: current.expectedIsError,
      assertions: current.assertions,
      enabled: current.enabled,
      source: current.source,
      sensitiveData: current.sensitiveData,
      ...update,
    });
    const tool = discoveredTool(options, input.serverId, input.toolName);
    validateSavedInput(input, tool);
    return {
      apiVersion: 1 as const,
      testCase: await store.updateCase(testCaseId, persisted(input), schemaHash(tool)),
    };
  });

  app.delete('/api/test-cases/:testCaseId', async (request) => {
    verifyOrigin(request, options.allowedOrigin);
    const session = await requireAuth(request, options.auth);
    verifyCsrf(request, session);
    const { testCaseId } = parseRequest(testCaseIdParamsSchema, request.params);
    if (!(await store.deleteCase(testCaseId))) {
      throw new HttpError({
        statusCode: 404,
        code: 'TEST_CASE_NOT_FOUND',
        message: 'Saved test case was not found.',
      });
    }
    return { apiVersion: 1 as const, deleted: true as const };
  });

  app.post(
    '/api/test-cases/run',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      verifyOrigin(request, options.allowedOrigin);
      const session = await requireAuth(request, options.auth);
      verifyCsrf(request, session);
      const controls = parseRequest(runTestCasesRequestSchema, request.body ?? {});
      const all = await store.listCases();
      const selected = controls.ids
        ? controls.ids.map((id) => all.find((item) => item.id === id)).filter(Boolean)
        : all;
      const results: SavedTestRunResult[] = [];
      for (const testCase of selected) {
        results.push(await executeCase(options, testCase!, controls));
      }
      return { apiVersion: 1 as const, results };
    },
  );

  app.post(
    '/api/test-cases/:testCaseId/run',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      verifyOrigin(request, options.allowedOrigin);
      const session = await requireAuth(request, options.auth);
      verifyCsrf(request, session);
      const { testCaseId } = parseRequest(testCaseIdParamsSchema, request.params);
      const controls = parseRequest(runTestCasesRequestSchema, request.body ?? {});
      const testCase = await store.getCase(testCaseId);
      if (!testCase) {
        throw new HttpError({
          statusCode: 404,
          code: 'TEST_CASE_NOT_FOUND',
          message: 'Saved test case was not found.',
        });
      }
      return {
        apiVersion: 1 as const,
        result: await executeCase(options, testCase, controls),
      };
    },
  );
}
