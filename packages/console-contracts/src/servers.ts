import { z } from 'zod';

import {
  catalogStateSchema,
  credentialStateSchema,
  healthSchema,
  runtimeStateSchema,
  serverStatusSchema,
} from './registry.js';
import { toolDefinitionSchema } from './tools.js';

export const serverIdParamsSchema = z.object({ serverId: z.string().min(1) }).strict();
export const toolParamsSchema = z
  .object({ serverId: z.string().min(1), toolName: z.string().min(1) })
  .strict();

export const inspectRequestSchema = z
  .object({
    forceRefresh: z.boolean().optional(),
  })
  .strict();

export const serverSummarySchema = z
  .object({
    id: z.string(),
    displayName: z.string(),
    description: z.string(),
    catalogState: catalogStateSchema,
    runtimeState: runtimeStateSchema,
    credentialState: credentialStateSchema,
    health: healthSchema,
    toolCount: z.number().int().nonnegative().optional(),
    lastCheckedAt: z.string().datetime().nullable(),
    lastErrorCode: z.string().nullable(),
  })
  .strict();

export const serverDetailSchema = z
  .object({
    ...serverSummarySchema.shape,
    requiredBuildPackage: z.string(),
    expectedTools: z.array(z.string()).optional(),
    supportsWriteTools: z.boolean(),
    transport: z.literal('stdio'),
    launchByDefault: z.boolean(),
    environmentPresence: z.record(z.string(), z.boolean()),
    uptimeSince: z.string().datetime().nullable(),
    pid: z.number().int().positive().nullable(),
    nextRetryAt: z.string().datetime().nullable(),
  })
  .strict();

export const inspectionResponseSchema = z
  .object({
    apiVersion: z.literal(1),
    status: serverStatusSchema,
    tools: z.array(toolDefinitionSchema),
    checkedAt: z.string().datetime(),
  })
  .strict();

export type ServerSummary = z.infer<typeof serverSummarySchema>;
export type ServerDetail = z.infer<typeof serverDetailSchema>;
export type InspectionResponse = z.infer<typeof inspectionResponseSchema>;

export const diagnosticsResponseSchema = z
  .object({
    serverId: z.string(),
    stderr: z.array(
      z.object({
        at: z.string().datetime(),
        text: z.string(),
        truncated: z.boolean(),
      }),
    ),
  })
  .strict();

export type DiagnosticsResponse = z.infer<typeof diagnosticsResponseSchema>;
