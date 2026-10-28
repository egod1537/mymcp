import { z } from 'zod';

const objectJsonSchema = z.looseObject({ type: z.literal('object') });

export const toolDefinitionSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    inputSchema: objectJsonSchema,
    outputSchema: objectJsonSchema.optional(),
    annotations: z
      .object({
        title: z.string().optional(),
        readOnlyHint: z.boolean().optional(),
        destructiveHint: z.boolean().optional(),
        idempotentHint: z.boolean().optional(),
        openWorldHint: z.boolean().optional(),
      })
      .optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const callToolRequestSchema = z
  .object({
    arguments: z.record(z.string(), z.unknown()),
    timeoutMs: z.number().int().min(1).max(60_000).optional(),
    confirmWrite: z.boolean().optional(),
  })
  .strict();

export const callToolResponseSchema = z
  .object({
    apiVersion: z.literal(1),
    requestId: z.string(),
    serverId: z.string(),
    toolName: z.string(),
    outcome: z.enum(['success', 'tool_error']),
    isError: z.boolean(),
    durationMs: z.number().nonnegative(),
    content: z.array(z.record(z.string(), z.unknown())),
    structuredContent: z.unknown().optional(),
    truncated: z.boolean().optional(),
    executedAt: z.string().datetime(),
  })
  .strict();

export type ToolDefinitionDto = z.infer<typeof toolDefinitionSchema>;
export type CallToolRequest = z.infer<typeof callToolRequestSchema>;
export type CallToolResponse = z.infer<typeof callToolResponseSchema>;
