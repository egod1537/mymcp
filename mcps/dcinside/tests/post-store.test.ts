import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PostStore,
  recordFilenameForCanonicalUrl,
  type StoredPostRecord,
} from '../src/store/post-store.js';

const canonicalUrl = 'https://gall.dcinside.com/board/view/?id=test&no=123';

function record(overrides: Partial<StoredPostRecord> = {}): StoredPostRecord {
  return {
    schemaVersion: 1,
    source: 'user_import',
    canonicalUrl,
    galleryId: 'test',
    galleryType: 'major',
    postNo: '123',
    title: '사용자 제공 제목',
    bodyText: '첫 줄\n둘째 줄',
    comments: [{ text: '댓글', commentId: 'c1' }],
    importedAt: '2026-10-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('PostStore', () => {
  let directory: string;
  let store: PostStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dcinside-store-'));
    store = new PostStore(directory);
  });

  afterEach(async () => {
    await import('node:fs/promises').then(({ rm }) =>
      rm(directory, { recursive: true, force: true }),
    );
  });

  it('round-trips Korean UTF-8 text and uses only a SHA-256 filename', async () => {
    const expected = record();
    await store.save(expected);
    expect(await store.get(canonicalUrl)).toEqual(expected);

    const files = await readdir(join(directory, 'posts'));
    expect(files).toEqual([recordFilenameForCanonicalUrl(canonicalUrl)]);
    expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/);
    expect(await readFile(join(directory, 'posts', files[0] ?? ''), 'utf8')).toContain(
      '첫 줄\\n둘째 줄',
    );
  });

  it('atomically replaces one record and serializes concurrent writes', async () => {
    await Promise.all([
      store.save(record({ title: 'first' })),
      store.save(record({ title: 'second', importedAt: '2026-10-28T00:00:01.000Z' })),
    ]);
    expect(await store.get(canonicalUrl)).toMatchObject({
      title: 'second',
      importedAt: '2026-10-28T00:00:01.000Z',
    });
    expect(
      (await readdir(join(directory, 'posts'))).filter((name) => name.endsWith('.tmp')),
    ).toEqual([]);
  });

  it('applies private directory and file permissions where supported', async () => {
    await store.save(record());
    if (process.platform !== 'win32') {
      const directoryMode = (await stat(join(directory, 'posts'))).mode & 0o777;
      const fileMode =
        (await stat(join(directory, 'posts', recordFilenameForCanonicalUrl(canonicalUrl)))).mode &
        0o777;
      expect(directoryMode).toBe(0o700);
      expect(fileMode).toBe(0o600);
    }
  });

  it('returns undefined for a missing item and DATA_CORRUPT for invalid JSON', async () => {
    expect(await store.get(canonicalUrl)).toBeUndefined();
    await mkdir(join(directory, 'posts'), { recursive: true });
    await writeFile(
      join(directory, 'posts', recordFilenameForCanonicalUrl(canonicalUrl)),
      '{broken',
      'utf8',
    );
    await expect(store.get(canonicalUrl)).rejects.toMatchObject({ code: 'DATA_CORRUPT' });
  });

  it('rejects invalid comments and payloads larger than 250 KiB', async () => {
    await expect(
      store.save(record({ comments: [{ text: 'x'.repeat(5_001) }] })),
    ).rejects.toMatchObject({
      code: 'INPUT_INVALID',
    });
    await expect(store.save(record({ bodyText: '한'.repeat(100_000) }))).rejects.toMatchObject({
      code: 'INPUT_INVALID',
    });
  });
});
