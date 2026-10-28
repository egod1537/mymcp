import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { getRegistryEntry, loadRegistry } from './registry.js';
import type { RegistryError } from './registry.js';

const directories: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mymcp-registry-'));
  directories.push(root);
  await mkdir(join(root, 'config'));
  await mkdir(join(root, 'apps/example/dist'), { recursive: true });
  await writeFile(join(root, 'apps/example/dist/index.js'), '');
  return root;
}

function validRegistry(entrypoint = 'apps/example/dist/index.js'): object {
  return {
    version: 1,
    servers: [
      {
        id: 'example',
        displayName: 'Example',
        description: 'Reference server',
        catalogState: 'supported',
        transport: 'stdio',
        command: 'node',
        args: [entrypoint],
        cwd: 'apps/example',
        requiredBuildPackage: '@mymcp/example',
        permittedEnvironmentKeys: [],
        expectedTools: ['echo'],
        launchByDefault: false,
      },
    ],
  };
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('loadRegistry', () => {
  it('resolves trusted paths and rejects unknown IDs', async () => {
    const root = await createRoot();
    await writeFile(join(root, 'config/registry.json'), JSON.stringify(validRegistry()));
    const registry = await loadRegistry({
      registryPath: 'config/registry.json',
      runtimeRoot: root,
    });

    expect(getRegistryEntry(registry, 'example').resolvedArgs[0]).toBe(
      join(registry.runtimeRoot, 'apps/example/dist/index.js'),
    );
    expect(() => getRegistryEntry(registry, 'missing')).toThrowError(
      expect.objectContaining<Partial<RegistryError>>({ code: 'REGISTRY_SERVER_NOT_FOUND' }),
    );
  });

  it('surfaces schema failures with a stable error code', async () => {
    const root = await createRoot();
    await writeFile(
      join(root, 'config/registry.json'),
      JSON.stringify({ version: 1, servers: [] }),
    );

    await expect(
      loadRegistry({ registryPath: 'config/registry.json', runtimeRoot: root }),
    ).rejects.toMatchObject({ code: 'REGISTRY_INVALID' });
  });

  it('loads a safe missing dist path so the manager can report BUILD_REQUIRED', async () => {
    const root = await createRoot();
    await writeFile(
      join(root, 'config/registry.json'),
      JSON.stringify(validRegistry('apps/example/dist/not-built.js')),
    );

    const registry = await loadRegistry({
      registryPath: 'config/registry.json',
      runtimeRoot: root,
    });
    expect(getRegistryEntry(registry, 'example').resolvedArgs[0]).toBe(
      join(registry.runtimeRoot, 'apps/example/dist/not-built.js'),
    );
  });

  it('rejects an entrypoint symlink that resolves outside the runtime root', async () => {
    const root = await createRoot();
    const outside = await mkdtemp(join(tmpdir(), 'mymcp-outside-'));
    directories.push(outside);
    await writeFile(join(outside, 'index.js'), '');
    await symlink(join(outside, 'index.js'), join(root, 'apps/example/dist/escape.js'));
    await writeFile(
      join(root, 'config/registry.json'),
      JSON.stringify(validRegistry('apps/example/dist/escape.js')),
    );

    await expect(
      loadRegistry({ registryPath: 'config/registry.json', runtimeRoot: root }),
    ).rejects.toMatchObject({ code: 'REGISTRY_PATH_INVALID' });
  });
});
