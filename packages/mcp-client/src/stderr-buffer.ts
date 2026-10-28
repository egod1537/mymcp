import { StringDecoder } from 'node:string_decoder';

import type { StderrLine } from './types.js';

const SECRET_PATTERNS = [
  /(bearer\s+)([^\s]+)/giu,
  /(authorization\s*[:=]\s*)([^\r\n]+)/giu,
  /((?:api[_-]?key|secret|token|password|cookie)\s*[:=]\s*)([^\s]+)/giu,
  /((?:[A-Za-z0-9_]*(?:_KEY|_TOKEN)|password|secret|cookie)["']?\s*[:=]\s*["']?)([^\s,"'}]+)/gu,
];

function redact(value: string): string {
  return SECRET_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, '$1[REDACTED]'),
    value,
  ).replace(/\/(?:Users|home)\/[^/\s]+/gu, '/[PRIVATE_PATH]');
}

export class StderrRingBuffer {
  readonly #decoder = new StringDecoder('utf8');
  readonly #lines: StderrLine[] = [];
  readonly #maxLines: number;
  readonly #maxLineBytes: number;
  #pending = '';

  constructor(maxLines = 200, maxLineBytes = 4096) {
    this.#maxLines = maxLines;
    this.#maxLineBytes = maxLineBytes;
  }

  append(chunk: Buffer | string): void {
    this.#pending += typeof chunk === 'string' ? chunk : this.#decoder.write(chunk);
    const lines = this.#pending.split(/\r?\n/u);
    this.#pending = lines.pop() ?? '';
    for (const line of lines) this.#push(line);
    if (Buffer.byteLength(this.#pending, 'utf8') > this.#maxLineBytes) {
      this.#push(this.#pending);
      this.#pending = '';
    }
  }

  flush(): void {
    this.#pending += this.#decoder.end();
    if (this.#pending) this.#push(this.#pending);
    this.#pending = '';
  }

  list(): readonly StderrLine[] {
    return this.#lines.map((line) => ({ ...line }));
  }

  #push(line: string): void {
    const source = Buffer.from(line, 'utf8');
    const truncated = source.byteLength > this.#maxLineBytes;
    const safe = truncated ? source.subarray(0, this.#maxLineBytes).toString('utf8') : line;
    this.#lines.push({ at: new Date().toISOString(), text: redact(safe), truncated });
    if (this.#lines.length > this.#maxLines) this.#lines.shift();
  }
}
