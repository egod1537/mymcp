import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { createExampleServer, echo } from './server.js';

describe('echo', () => {
  it('returns its input unchanged', () => {
    expect(echo('hello from MCP')).toBe('hello from MCP');
  });
});

describe('example MCP protocol', () => {
  it('lists and invokes the echo tool over an MCP transport', async () => {
    const server = createExampleServer();
    const client = new Client({ name: 'example-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map(({ name }) => name)).toContain('echo');

      const result = await client.callTool({
        name: 'echo',
        arguments: { message: 'protocol smoke test' },
      });

      expect(result.content).toEqual([{ type: 'text', text: 'protocol smoke test' }]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('rejects input that does not match the tool schema', async () => {
    const server = createExampleServer();
    const client = new Client({ name: 'example-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.callTool({
        name: 'echo',
        arguments: { message: 42 },
      });

      expect(result.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
