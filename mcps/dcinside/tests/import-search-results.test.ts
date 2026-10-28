import { describe, expect, it } from 'vitest';
import { parseSearchResultsImport } from '../src/import/search-results.js';

const columns =
  'index,galleryId,keyword,searchType,title,author,date,views,recommends,commentCount,postId,url,searchStep,sourceUrl';
const limits = { maxBytes: 1_048_576, maxRows: 1_000 };

describe('search result importer', () => {
  it('supports BOM, CRLF, quoted commas/newlines, and escaped quotes', () => {
    const data =
      `\uFEFF${columns}\r\n` +
      '1,japan,항공,all,"제목, ""인용""\n둘째줄",secret,2026.10.01,1,2,3,7,https://gall.dcinside.com/mgallery/board/view/?id=japan&no=7,0,javascript:ignored\r\n';
    const result = parseSearchResultsImport(
      'csv',
      data,
      undefined,
      '2026-10-28T00:00:00.000Z',
      limits,
    );
    expect(result.rejected).toBe(0);
    expect(result.records[0]).toMatchObject({
      title: '제목, "인용"\n둘째줄',
      galleryId: 'japan',
      postNo: '7',
      views: 1,
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('javascript:');
  });

  it('rejects URL identity mismatches without echoing raw rows', () => {
    const data = `${columns}\n1,other,x,all,title,private,,0,0,0,7,https://gall.dcinside.com/mgallery/board/view/?id=japan&no=8,0,file:///private`;
    const result = parseSearchResultsImport(
      'csv',
      data,
      undefined,
      '2026-10-28T00:00:00.000Z',
      limits,
    );
    expect(result.records).toEqual([]);
    expect(result.rejected).toBe(1);
    expect(JSON.stringify(result)).not.toContain('file:///private');
  });

  it('enforces byte and row bounds before indexing', () => {
    expect(() =>
      parseSearchResultsImport('json', '[]', undefined, '2026-10-28T00:00:00.000Z', {
        maxBytes: 1,
        maxRows: 1_000,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INPUT_INVALID' }));
    const rows = Array.from({ length: 1_001 }, (_value, index) => ({
      galleryId: 'test',
      postId: String(index + 1),
      title: 'x',
      url: `https://gall.dcinside.com/board/view/?id=test&no=${index + 1}`,
    }));
    expect(() =>
      parseSearchResultsImport(
        'json',
        JSON.stringify(rows),
        undefined,
        '2026-10-28T00:00:00.000Z',
        limits,
      ),
    ).toThrowError(expect.objectContaining({ code: 'INPUT_INVALID' }));
  });

  it('counts primitive JSON entries as rejected rows', () => {
    const result = parseSearchResultsImport(
      'json',
      JSON.stringify(['bad', null]),
      undefined,
      '2026-10-28T00:00:00.000Z',
      limits,
    );
    expect(result.records).toEqual([]);
    expect(result.rejected).toBe(2);
  });
});
