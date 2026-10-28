import { describe, expect, it } from 'vitest';

import { mcpRegistrySchema } from './registry.js';

const server = {
  id: 'example',
  displayName: 'Example',
  description: 'Reference server',
  catalogState: 'supported',
  transport: 'stdio',
  command: 'node',
  args: ['apps/example/dist/index.js'],
  cwd: 'apps/example',
  requiredBuildPackage: '@mymcp/example',
  permittedEnvironmentKeys: [],
  expectedTools: ['echo'],
  launchByDefault: false,
} as const;

describe('mcpRegistrySchema', () => {
  it('accepts the constrained stdio model', () => {
    expect(mcpRegistrySchema.parse({ version: 1, servers: [server] }).servers[0]?.id).toBe(
      'example',
    );
  });

  it('rejects duplicate IDs and unverified auto-launch', () => {
    expect(() => mcpRegistrySchema.parse({ version: 1, servers: [server, server] })).toThrow(
      /Duplicate server id/,
    );
    expect(() =>
      mcpRegistrySchema.parse({
        version: 1,
        servers: [{ ...server, catalogState: 'unverified', launchByDefault: true }],
      }),
    ).toThrow(/Only supported servers/);
  });

  it('rejects shell-like and escaping paths', () => {
    for (const args of [['../outside.js'], ['apps/example/dist/index.js;whoami']]) {
      expect(() =>
        mcpRegistrySchema.parse({ version: 1, servers: [{ ...server, args }] }),
      ).toThrow();
    }
  });
});
