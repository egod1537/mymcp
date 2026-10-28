export interface ImportPreview {
  total: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  galleries: string[];
  error?: string;
}

function csvRows(data: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < data.length; index += 1) {
    const character = data[index];
    if (quoted) {
      if (character === '"' && data[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field.length === 0) quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/u, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  if (quoted) throw new Error('CSV contains an unclosed quote.');
  if (field || row.length) rows.push([...row, field.replace(/\r$/u, '')]);
  return rows;
}

function valuesFor(format: 'csv' | 'json', data: string): unknown[] {
  if (format === 'json') {
    const parsed = JSON.parse(data) as unknown;
    if (Array.isArray(parsed)) return parsed;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as { results?: unknown }).results)
    ) {
      return (parsed as { results: unknown[] }).results;
    }
    throw new Error('JSON must be an array or {results:[]}.');
  }
  const rows = csvRows(data.replace(/^\uFEFF/u, ''));
  const headers = rows.shift()?.map((value) => value.trim()) ?? [];
  for (const required of ['galleryId', 'title', 'postId', 'url']) {
    if (!headers.includes(required)) throw new Error(`CSV is missing ${required}.`);
  }
  return rows
    .filter((row) => row.some(Boolean))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

function identity(value: unknown): { canonical: string; galleryId: string } | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.url !== 'string' || typeof row.title !== 'string' || !row.title.trim())
    return undefined;
  try {
    const url = new URL(row.url);
    if (url.protocol !== 'https:' || url.hostname !== 'gall.dcinside.com') return undefined;
    if (
      ![
        '/board/view',
        '/board/view/',
        '/mgallery/board/view',
        '/mgallery/board/view/',
        '/mini/board/view',
        '/mini/board/view/',
      ].includes(url.pathname)
    )
      return undefined;
    const galleryId = url.searchParams.get('id') ?? '';
    const postNo = (url.searchParams.get('no') ?? '').replace(/^0+(?=\d)/u, '');
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(galleryId) || !/^\d+$/u.test(postNo)) return undefined;
    if (typeof row.galleryId === 'string' && row.galleryId && row.galleryId !== galleryId)
      return undefined;
    if (String(row.postId ?? postNo).replace(/^0+(?=\d)/u, '') !== postNo) return undefined;
    const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
    return {
      canonical: `https://gall.dcinside.com${path}?id=${galleryId}&no=${postNo}`,
      galleryId,
    };
  } catch {
    return undefined;
  }
}

export function previewSearchImport(format: 'csv' | 'json', data: string): ImportPreview {
  try {
    const values = valuesFor(format, data);
    const seen = new Set<string>();
    const galleries = new Set<string>();
    let accepted = 0;
    let duplicates = 0;
    let rejected = 0;
    for (const value of values) {
      const parsed = identity(value);
      if (!parsed) {
        rejected += 1;
      } else if (seen.has(parsed.canonical)) {
        duplicates += 1;
      } else {
        seen.add(parsed.canonical);
        galleries.add(parsed.galleryId);
        accepted += 1;
      }
    }
    return { total: values.length, accepted, duplicates, rejected, galleries: [...galleries] };
  } catch (error) {
    return {
      total: 0,
      accepted: 0,
      duplicates: 0,
      rejected: 0,
      galleries: [],
      error: error instanceof Error ? error.message : 'Could not preview this file.',
    };
  }
}
