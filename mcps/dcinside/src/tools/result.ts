import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toErrorPayload } from '../errors.js';

export function successResult<T extends Record<string, unknown>>(value: T): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

export function errorResult(error: unknown): CallToolResult {
  const payload = { ...toErrorPayload(error) };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: true,
  };
}
