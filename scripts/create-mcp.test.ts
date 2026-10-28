import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createMcpApp, validateName } from './create-mcp.mjs';

const temporaryDirectories: string[] = [];

async function createTemporaryWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'mymcp-scaffold-'));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, 'apps'));
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('validateName', () => {
  it.each(['../escape', 'Uppercase', 'two words', '-leading', 'trailing-', ''])(
    'rejects unsafe or non-kebab-case name %j',
    (name) => {
      expect(() => validateName(name)).toThrow(/kebab-case/);
    },
  );

  it.each(['weather', 'weather-tools', 'mcp2-server'])('accepts %s', (name) => {
    expect(() => validateName(name)).not.toThrow();
  });
});

describe('createMcpApp', () => {
  it('generates a complete workspace package', async () => {
    const rootDirectory = await createTemporaryWorkspace();
    const targetDirectory = await createMcpApp('weather-tools', { rootDirectory });

    const packageContents = JSON.parse(
      await readFile(join(targetDirectory, 'package.json'), 'utf8'),
    ) as { name: string; dependencies: Record<string, string> };

    expect(packageContents.name).toBe('@mymcp/weather-tools');
    expect(packageContents.dependencies['@mymcp/shared']).toBe('workspace:*');

    await expect(readFile(join(targetDirectory, 'tsconfig.json'), 'utf8')).resolves.toContain(
      '../../packages/config/tsconfig.base.json',
    );
    await expect(readFile(join(targetDirectory, 'tsconfig.build.json'), 'utf8')).resolves.toContain(
      'src/**/*.test.ts',
    );
    await expect(readFile(join(targetDirectory, 'src/index.ts'), 'utf8')).resolves.toContain(
      'StdioServerTransport',
    );
    await expect(readFile(join(targetDirectory, 'src/server.ts'), 'utf8')).resolves.toContain(
      "registerTool(\n    'echo'",
    );
    await expect(readFile(join(targetDirectory, 'src/server.test.ts'), 'utf8')).resolves.toContain(
      "describe('echo'",
    );
    await expect(readFile(join(targetDirectory, 'README.md'), 'utf8')).resolves.toContain(
      '@mymcp/weather-tools',
    );
  });

  it('fails without modifying an existing target', async () => {
    const rootDirectory = await createTemporaryWorkspace();
    const targetDirectory = await createMcpApp('existing-app', { rootDirectory });
    const serverPath = join(targetDirectory, 'src/server.ts');
    const before = await readFile(serverPath, 'utf8');

    await expect(createMcpApp('existing-app', { rootDirectory })).rejects.toThrow(
      /Target already exists/,
    );
    await expect(readFile(serverPath, 'utf8')).resolves.toBe(before);
  });
});
