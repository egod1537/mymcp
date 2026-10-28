import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { mcpRegistrySchema } from '@mymcp/console-contracts';
import type { ConsoleErrorCode, McpRegistryEntry } from '@mymcp/console-contracts';

import type { LoadedRegistry, ResolvedRegistryEntry } from './types.js';

export class RegistryError extends Error {
  readonly code: ConsoleErrorCode;
  override readonly cause?: unknown;

  constructor(code: ConsoleErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'RegistryError';
    this.code = code;
    this.cause = options?.cause;
  }
}

function isWithin(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
  );
}

async function resolveInside(root: string, relativePath: string, label: string): Promise<string> {
  const candidate = resolve(root, relativePath);
  if (!isWithin(root, candidate)) {
    throw new RegistryError('REGISTRY_PATH_INVALID', `${label} escapes the runtime root`);
  }

  let canonicalPath: string;
  try {
    canonicalPath = await realpath(candidate);
  } catch (error) {
    throw new RegistryError('REGISTRY_PATH_INVALID', `${label} does not exist`, { cause: error });
  }

  if (!isWithin(root, canonicalPath)) {
    throw new RegistryError('REGISTRY_PATH_INVALID', `${label} resolves outside the runtime root`);
  }
  return canonicalPath;
}

async function resolveEntrypointInside(
  root: string,
  relativePath: string,
  label: string,
): Promise<string> {
  const candidate = resolve(root, relativePath);
  if (!isWithin(root, candidate)) {
    throw new RegistryError('REGISTRY_PATH_INVALID', `${label} escapes the runtime root`);
  }

  try {
    const canonicalPath = await realpath(candidate);
    if (!isWithin(root, canonicalPath)) {
      throw new RegistryError(
        'REGISTRY_PATH_INVALID',
        `${label} resolves outside the runtime root`,
      );
    }
    return canonicalPath;
  } catch (error) {
    if (error instanceof RegistryError) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new RegistryError('REGISTRY_PATH_INVALID', `${label} cannot be resolved`, {
        cause: error,
      });
    }

    const canonicalParent = await resolveInside(
      root,
      relative(root, resolve(candidate, '..')),
      `${label} parent`,
    );
    return resolve(canonicalParent, candidate.slice(candidate.lastIndexOf(sep) + 1));
  }
}

async function resolveEntry(
  runtimeRoot: string,
  entry: McpRegistryEntry,
): Promise<ResolvedRegistryEntry> {
  const resolvedCwd = await resolveInside(runtimeRoot, entry.cwd, `cwd for ${entry.id}`);
  const resolvedEntrypoint = await resolveEntrypointInside(
    runtimeRoot,
    entry.args[0],
    `entrypoint for ${entry.id}`,
  );
  return { ...entry, resolvedArgs: [resolvedEntrypoint], resolvedCwd };
}

export async function loadRegistry(options: {
  registryPath: string;
  runtimeRoot: string;
}): Promise<LoadedRegistry> {
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(options.runtimeRoot);
  } catch (error) {
    throw new RegistryError('REGISTRY_PATH_INVALID', 'Runtime root does not exist', {
      cause: error,
    });
  }

  const registryCandidate = isAbsolute(options.registryPath)
    ? options.registryPath
    : resolve(canonicalRoot, options.registryPath);
  const canonicalRegistryPath = await resolveInside(
    canonicalRoot,
    relative(canonicalRoot, registryCandidate),
    'registry file',
  );

  let source: string;
  try {
    source = await readFile(canonicalRegistryPath, 'utf8');
  } catch (error) {
    throw new RegistryError('REGISTRY_INVALID', 'Registry file could not be read', {
      cause: error,
    });
  }

  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch (error) {
    throw new RegistryError('REGISTRY_INVALID', 'Registry file is not valid JSON', {
      cause: error,
    });
  }

  const parsed = mcpRegistrySchema.safeParse(input);
  if (!parsed.success) {
    throw new RegistryError('REGISTRY_INVALID', 'Registry schema validation failed', {
      cause: parsed.error,
    });
  }

  const servers = await Promise.all(
    parsed.data.servers.map((entry) => resolveEntry(canonicalRoot, entry)),
  );
  return {
    path: canonicalRegistryPath,
    runtimeRoot: canonicalRoot,
    servers,
  };
}

export function getRegistryEntry(registry: LoadedRegistry, id: string): ResolvedRegistryEntry {
  const entry = registry.servers.find((server) => server.id === id);
  if (!entry) {
    throw new RegistryError('REGISTRY_SERVER_NOT_FOUND', `Server is not registered: ${id}`);
  }
  return entry;
}
