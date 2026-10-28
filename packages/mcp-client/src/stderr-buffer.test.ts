import { describe, expect, it } from 'vitest';

import { StderrRingBuffer } from './stderr-buffer.js';

describe('StderrRingBuffer', () => {
  it('redacts common secret forms, truncates lines, and bounds history', () => {
    const buffer = new StderrRingBuffer(2, 32);
    buffer.append('token=super-secret\n');
    buffer.append('Authorization: Bearer credential\n');
    buffer.append('{"BRAVE_SEARCH_API_KEY":"api-secret","path":"/Users/yang/private"}\n');
    buffer.append(`${'x'.repeat(40)}\n`);

    const lines = buffer.list();
    expect(lines).toHaveLength(2);
    expect(lines.map(({ text }) => text).join(' ')).not.toContain('credential');
    expect(lines.map(({ text }) => text).join(' ')).not.toContain('api-secret');
    expect(lines.map(({ text }) => text).join(' ')).not.toContain('/Users/yang');
    expect(lines[1]).toMatchObject({ truncated: true });
  });
});
