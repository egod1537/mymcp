import { describe, expect, it } from 'vitest';
import { previewSearchImport } from './importPreview.js';

describe('previewSearchImport', () => {
  it('summarizes valid, duplicate, rejected, and gallery counts locally', () => {
    const result = previewSearchImport(
      'json',
      JSON.stringify([
        {
          galleryId: 'test',
          postId: '1',
          title: 'one',
          url: 'https://gall.dcinside.com/board/view/?id=test&no=1',
        },
        {
          galleryId: 'test',
          postId: '1',
          title: 'duplicate',
          url: 'https://gall.dcinside.com/board/view/?id=test&no=1&page=2',
        },
        { title: 'bad', url: 'https://example.com' },
      ]),
    );
    expect(result).toEqual({
      total: 3,
      accepted: 1,
      duplicates: 1,
      rejected: 1,
      galleries: ['test'],
    });
  });
});
