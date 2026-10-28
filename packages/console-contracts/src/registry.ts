import { z } from 'zod';

const idSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const toolNameSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);
const packageNameSchema = z.string().regex(/^@mymcp\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
const environmentKeySchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const safeRelativePathSchema = z
  .string()
  .min(1)
  .max(240)
  .refine((value) => !value.startsWith('/') && !value.startsWith('\\'), 'Must be relative')
  .refine((value) => !value.includes('\\'), 'Use forward slashes')
  .refine(
    (value) => !value.split('/').some((segment) => segment === '..' || segment === ''),
    'Path traversal and empty segments are not allowed',
  )
  .refine((value) => !/[;&|`$<>\n\r]/u.test(value), 'Shell metacharacters are not allowed');

export const catalogStateSchema = z.enum(['supported', 'unverified', 'disabled']);
export const runtimeStateSchema = z.enum([
  'not_started',
  'connecting',
  'ready',
  'degraded',
  'disconnected',
  'error',
]);
export const credentialStateSchema = z.enum(['not_required', 'configured', 'missing', 'unknown']);
export const healthSchema = z.enum(['unknown', 'ok', 'warning', 'failing']);

export const mcpRegistryEntrySchema = z
  .object({
    id: idSchema,
    displayName: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500),
    catalogState: catalogStateSchema,
    transport: z.literal('stdio'),
    command: z.literal('node'),
    args: z.tuple([
      safeRelativePathSchema.refine((value) => value.endsWith('.js'), 'Expected .js'),
    ]),
    cwd: safeRelativePathSchema,
    requiredBuildPackage: packageNameSchema,
    permittedEnvironmentKeys: z.array(environmentKeySchema).max(32),
    expectedTools: z.array(toolNameSchema).max(100).optional(),
    supportsWriteTools: z.boolean().optional(),
    launchByDefault: z.boolean(),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.catalogState !== 'supported' && entry.launchByDefault) {
      context.addIssue({
        code: 'custom',
        path: ['launchByDefault'],
        message: 'Only supported servers may launch by default',
      });
    }
    if (new Set(entry.permittedEnvironmentKeys).size !== entry.permittedEnvironmentKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['permittedEnvironmentKeys'],
        message: 'Environment keys must be unique',
      });
    }
    if (entry.expectedTools && new Set(entry.expectedTools).size !== entry.expectedTools.length) {
      context.addIssue({
        code: 'custom',
        path: ['expectedTools'],
        message: 'Expected tool names must be unique',
      });
    }
  });

export const mcpRegistrySchema = z
  .object({
    version: z.literal(1),
    servers: z.array(mcpRegistryEntrySchema).min(1).max(100),
  })
  .strict()
  .superRefine((registry, context) => {
    const ids = new Set<string>();
    for (const [index, server] of registry.servers.entries()) {
      if (ids.has(server.id)) {
        context.addIssue({
          code: 'custom',
          path: ['servers', index, 'id'],
          message: `Duplicate server id: ${server.id}`,
        });
      }
      ids.add(server.id);
    }
  });

export const serverStatusSchema = z
  .object({
    id: idSchema,
    catalogState: catalogStateSchema,
    runtimeState: runtimeStateSchema,
    credentialState: credentialStateSchema,
    health: healthSchema,
    lastCheckedAt: z.string().datetime().nullable(),
    lastErrorCode: z.string().min(1).nullable(),
    uptimeSince: z.string().datetime().nullable(),
  })
  .strict();

export type CatalogState = z.infer<typeof catalogStateSchema>;
export type RuntimeState = z.infer<typeof runtimeStateSchema>;
export type CredentialState = z.infer<typeof credentialStateSchema>;
export type Health = z.infer<typeof healthSchema>;
export type McpRegistryEntry = z.infer<typeof mcpRegistryEntrySchema>;
export type McpRegistry = z.infer<typeof mcpRegistrySchema>;
export type ServerStatus = z.infer<typeof serverStatusSchema>;
