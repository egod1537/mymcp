import { describe, expect, it, vi } from 'vitest';
import { parseDcPostUrl } from '../src/core/dc-url.js';
import { DomainError } from '../src/errors.js';

describe('parseDcPostUrl', () => {
  it.each([
    [
      'https://gall.dcinside.com/board/view/?id=programming&no=123&page=2#reply',
      'major',
      'https://gall.dcinside.com/board/view/?id=programming&no=123',
    ],
    [
      'https://gall.dcinside.com/mgallery/board/view?id=example_gallery&no=00042&utm_source=test',
      'minor',
      'https://gall.dcinside.com/mgallery/board/view/?id=example_gallery&no=42',
    ],
    [
      'https://gall.dcinside.com/mini/board/view/?no=999&id=mini-gallery',
      'mini',
      'https://gall.dcinside.com/mini/board/view/?id=mini-gallery&no=999',
    ],
  ])('parses and canonicalizes %s', (url, galleryType, canonicalUrl) => {
    expect(parseDcPostUrl(url)).toMatchObject({ galleryType, canonicalUrl });
  });

  it("preserves post numbers larger than JavaScript's safe integer range", () => {
    expect(
      parseDcPostUrl('https://gall.dcinside.com/board/view/?id=test&no=900719925474099312345')
        .postNo,
    ).toBe('900719925474099312345');
  });

  it.each([
    'http://gall.dcinside.com/board/view/?id=a&no=1',
    'ftp://gall.dcinside.com/board/view/?id=a&no=1',
    'javascript:alert(1)',
    'https://user@gall.dcinside.com/board/view/?id=a&no=1',
    'https://gall.dcinside.com:443/board/view/?id=a&no=1',
    'https://gall.dcinside.com:444/board/view/?id=a&no=1',
    'https://m.dcinside.com/board/a/1',
    'https://gall.dcinside.com.evil.example/board/view/?id=a&no=1',
    'https://127.0.0.1/board/view/?id=a&no=1',
    'https://gall.dcinside.com/board/lists/?id=a&no=1',
    'https://gall.dcinside.com/board/view/?no=1',
    'https://gall.dcinside.com/board/view/?id=a',
    'https://gall.dcinside.com/board/view/?id=a&id=b&no=1',
    'https://gall.dcinside.com/board/view/?id=a&no=1&no=2',
    'https://gall.dcinside.com/board/view/?id=&no=1',
    'https://gall.dcinside.com/board/view/?id=bad.id&no=1',
    `https://gall.dcinside.com/board/view/?id=${'a'.repeat(65)}&no=1`,
    'https://gall.dcinside.com/board/view/?id=a&no=0',
    'https://gall.dcinside.com/board/view/?id=a&no=-1',
    'https://gall.dcinside.com/board/view/?id=a&no=1.5',
    'https://gall.dcinside.com/board/view/?id=a&no=NaN',
  ])('rejects unsupported or malicious URL %s', (url) => {
    expect(() => parseDcPostUrl(url)).toThrow(DomainError);
    try {
      parseDcPostUrl(url);
    } catch (error) {
      expect(error).toMatchObject({ code: 'INPUT_INVALID' });
    }
  });

  it('never performs a network request', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      parseDcPostUrl('https://gall.dcinside.com/board/view/?id=test&no=1');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
