#!/usr/bin/env node

import { constants } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const kebabCaseName = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function packageJson(name) {
  return `${JSON.stringify(
    {
      name: `@mymcp/${name}`,
      version: '0.1.0',
      description: `${name} MCP server`,
      type: 'module',
      engines: { node: '>=22' },
      bin: { [`mymcp-${name}`]: 'dist/index.js' },
      files: ['dist', 'README.md'],
      exports: { '.': { types: './dist/server.d.ts', import: './dist/server.js' } },
      scripts: {
        build: 'tsc -p tsconfig.build.json',
        clean: `node -e "require('node:fs').rmSync('dist',{recursive:true,force:true})"`,
        dev: 'tsx watch src/index.ts',
        start: 'node dist/index.js',
        test: 'vitest run',
        typecheck: 'tsc -p tsconfig.json --noEmit',
      },
      dependencies: {
        '@modelcontextprotocol/sdk': '1.32.2',
        '@mymcp/shared': 'workspace:*',
        zod: '4.6.7',
      },
      devDependencies: {
        '@types/node': '22.20.5',
        tsx: '4.23.15',
        typescript: '6.0.3',
        vitest: '5.0.5',
      },
    },
    null,
    2,
  )}\n`;
}

function tsconfig() {
  return `${JSON.stringify(
    {
      extends: '../../packages/config/tsconfig.base.json',
      compilerOptions: {
        outDir: 'dist',
        rootDir: 'src',
        tsBuildInfoFile: 'dist/.tsbuildinfo',
      },
      include: ['src/**/*.ts'],
    },
    null,
    2,
  )}\n`;
}

function buildTsconfig() {
  return `${JSON.stringify(
    {
      extends: './tsconfig.json',
      exclude: ['src/**/*.test.ts'],
    },
    null,
    2,
  )}\n`;
}

function serverSource(name) {
  return `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function echo(message: string): string {
  return message;
}

export function createServer(): McpServer {
  const server = new McpServer({ name: '@mymcp/${name}', version: '0.1.0' });

  server.registerTool(
    'echo',
    {
      description: 'Return the supplied message unchanged.',
      inputSchema: { message: z.string().describe('Text to return') },
    },
    async ({ message }) => ({
      content: [{ type: 'text', text: echo(message) }],
    }),
  );

  return server;
}
`;
}

function indexSource(name) {
  return `#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createLogger } from '@mymcp/shared';

import { createServer } from './server.js';

const logger = createLogger('@mymcp/${name}');
const server = createServer();
let isClosing = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isClosing) return;
  isClosing = true;
  logger.info('Shutting down MCP server', { signal });

  try {
    await server.close();
  } catch (error) {
    logger.error('Failed to close MCP server', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
  logger.info('MCP server started', { transport: 'stdio' });
}

main().catch((error: unknown) => {
  logger.error('MCP server failed', {
    error: error instanceof Error ? error.message : 'Unknown error',
  });
  process.exitCode = 1;
});
`;
}

function testSource() {
  return `import { describe, expect, it } from 'vitest';

import { echo } from './server.js';

describe('echo', () => {
  it('returns its input unchanged', () => {
    expect(echo('hello')).toBe('hello');
  });
});
`;
}

function readme(name) {
  return `# \`@mymcp/${name}\`

Generated stdio MCP server.

## Develop

From the repository root:

\`\`\`bash
pnpm install
pnpm --filter @mymcp/${name} test
pnpm --filter @mymcp/${name}... build
node apps/${name}/dist/index.js
\`\`\`

Replace the starter \`echo\` tool with this server's documented capabilities. Keep protocol
output on stdout and send operational logs to stderr.
`;
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export function validateName(name) {
  if (!kebabCaseName.test(name)) {
    throw new Error(
      'Name must be kebab-case, start with a letter, and contain only lowercase letters, digits, and hyphens.',
    );
  }
}

export async function createMcpApp(name, options = {}) {
  validateName(name);

  const rootDirectory = resolve(
    options.rootDirectory ?? join(dirname(fileURLToPath(import.meta.url)), '..'),
  );
  const appsDirectory = resolve(rootDirectory, 'apps');
  const targetDirectory = resolve(appsDirectory, name);

  if (dirname(targetDirectory) !== appsDirectory) {
    throw new Error('Refusing to create an app outside the workspace apps directory.');
  }

  if (await exists(targetDirectory)) {
    throw new Error(`Target already exists: ${targetDirectory}`);
  }

  await mkdir(appsDirectory, { recursive: true });
  await mkdir(targetDirectory, { recursive: false });
  await mkdir(join(targetDirectory, 'src'), { recursive: false });

  const files = new Map([
    ['package.json', packageJson(name)],
    ['tsconfig.json', tsconfig()],
    ['tsconfig.build.json', buildTsconfig()],
    ['README.md', readme(name)],
    ['src/index.ts', indexSource(name)],
    ['src/server.ts', serverSource(name)],
    ['src/server.test.ts', testSource()],
  ]);

  await Promise.all(
    [...files].map(([relativePath, contents]) =>
      writeFile(join(targetDirectory, relativePath), contents, { encoding: 'utf8', flag: 'wx' }),
    ),
  );

  return targetDirectory;
}

async function run() {
  const [name, ...extraArguments] = process.argv.slice(2);

  if (!name || extraArguments.length > 0) {
    throw new Error('Usage: pnpm create:mcp <kebab-case-name>');
  }

  const targetDirectory = await createMcpApp(name);
  console.error(`Created @mymcp/${name} at ${targetDirectory}`);
  console.error('Next steps:');
  console.error('  pnpm install');
  console.error(`  pnpm --filter @mymcp/${name} test`);
  console.error(`  pnpm --filter @mymcp/${name}... build`);
  console.error(`  node apps/${name}/dist/index.js`);
}

const isDirectExecution =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Failed to create MCP app.');
    process.exitCode = 1;
  });
}
