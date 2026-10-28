import { z } from 'zod';

export const testAssertionSchema = z
  .object({
    path: z
      .string()
      .max(500)
      .refine((value) => value === '' || value.startsWith('/'), {
        message: 'Assertion path must be a JSON Pointer.',
      }),
    op: z.enum(['exists', 'equals', 'type', 'contains']),
    expected: z.unknown().optional(),
  })
  .strict();

export const savedTestCaseInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2_000).default(''),
    serverId: z.string().min(1).max(100),
    toolName: z.string().min(1).max(200),
    arguments: z.record(z.string(), z.unknown()),
    expectedIsError: z.boolean().optional(),
    assertions: z.array(testAssertionSchema).max(50).default([]),
    enabled: z.boolean().default(true),
    source: z.enum(['synthetic', 'user-provided']).default('synthetic'),
    sensitiveData: z.boolean().default(false),
    confirmSensitive: z.boolean().optional(),
  })
  .strict();

export const savedTestCaseUpdateSchema = savedTestCaseInputSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required.' });

export const testCaseIdParamsSchema = z.object({ testCaseId: z.string().uuid() }).strict();

export const runTestCasesRequestSchema = z
  .object({
    ids: z.array(z.string().uuid()).max(200).optional(),
    includeWriteTools: z.boolean().default(false),
    confirmWrite: z.boolean().default(false),
    confirmExternal: z.boolean().default(false),
  })
  .strict();

export type TestAssertion = z.infer<typeof testAssertionSchema>;
export type SavedTestCaseInput = z.infer<typeof savedTestCaseInputSchema>;
export type SavedTestCaseUpdate = z.infer<typeof savedTestCaseUpdateSchema>;

export interface TestAssertionResult {
  path: string;
  op: TestAssertion['op'];
  passed: boolean;
  message: string;
}

export interface SavedTestRunResult {
  id: string;
  testCaseId: string;
  status: 'passed' | 'failed' | 'skipped' | 'errored';
  durationMs: number | null;
  reason: string | null;
  requestId: string | null;
  assertionResults: TestAssertionResult[];
  ranAtUtc: string;
}

export interface SavedTestCase {
  id: string;
  name: string;
  description: string;
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  expectedIsError?: boolean | undefined;
  assertions: TestAssertion[];
  createdAtUtc: string;
  updatedAtUtc: string;
  schemaSnapshotHash: string;
  enabled: boolean;
  source: 'synthetic' | 'user-provided';
  sensitiveData: boolean;
  latestResult: SavedTestRunResult | null;
}
