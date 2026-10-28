import { parseDcPostUrl } from '../core/dc-url.js';
import { sanitizeStoredText } from '../core/text.js';
import { DomainError } from '../errors.js';
import type { SearchIndexRecord } from '../store/search-index.js';

const CSV_COLUMNS = [
  'index',
  'galleryId',
  'keyword',
  'searchType',
  'title',
  'author',
  'date',
  'views',
  'recommends',
  'commentCount',
  'postId',
  'url',
  'searchStep',
  'sourceUrl',
] as const;

export interface ImportDiagnostic {
  row: number;
  code: string;
  message: string;
}

export interface ParsedSearchImport {
  records: SearchIndexRecord[];
  rejected: number;
  diagnostics: ImportDiagnostic[];
}

export interface SearchImportLimits {
  maxBytes: number;
  maxRows: number;
}

function parseCsv(data: string): string[][] {
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
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (quoted) throw new DomainError('PARSE_FAILED', 'CSV contains an unclosed quote.', false);
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function recordsFromCsv(data: string): Record<string, unknown>[] {
  const rows = parseCsv(data.replace(/^\uFEFF/, ''));
  if (rows.length === 0) return [];
  const headers = rows[0]?.map((value) => value.trim()) ?? [];
  for (const required of CSV_COLUMNS) {
    if (!headers.includes(required)) {
      throw new DomainError('PARSE_FAILED', `CSV is missing the ${required} column.`, false);
    }
  }
  return rows
    .slice(1)
    .filter((row) => row.some(Boolean))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

function recordsFromJson(data: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    throw new DomainError('PARSE_FAILED', 'JSON import is not valid JSON.', false);
  }
  const values = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' &&
        parsed !== null &&
        Array.isArray((parsed as { results?: unknown }).results)
      ? (parsed as { results: unknown[] }).results
      : undefined;
  if (!values)
    throw new DomainError('PARSE_FAILED', 'JSON import must be an array or {results:[]}.', false);
  return values;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? sanitizeStoredText(String(value)).trim()
    : '';
}

function nonnegativeInteger(value: unknown): number | undefined {
  const normalized = stringValue(value);
  if (!/^\d+$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function parseSearchResultsImport(
  format: 'csv' | 'json',
  data: string,
  galleryOverride: string | undefined,
  capturedAt: string,
  limits: SearchImportLimits,
): ParsedSearchImport {
  if (Buffer.byteLength(data, 'utf8') > limits.maxBytes) {
    throw new DomainError(
      'INPUT_INVALID',
      `Import exceeds the ${limits.maxBytes} byte limit.`,
      false,
    );
  }
  const values = format === 'csv' ? recordsFromCsv(data) : recordsFromJson(data);
  if (values.length > limits.maxRows) {
    throw new DomainError(
      'INPUT_INVALID',
      `Import exceeds the ${limits.maxRows} row limit.`,
      false,
    );
  }
  const records: SearchIndexRecord[] = [];
  const diagnostics: ImportDiagnostic[] = [];
  for (const [index, value] of values.entries()) {
    try {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('row must be an object');
      }
      const row = value as Record<string, unknown>;
      const url = stringValue(row.url);
      const parsed = parseDcPostUrl(url);
      const galleryId = stringValue(row.galleryId) || galleryOverride || parsed.galleryId;
      const postId = stringValue(row.postId) || parsed.postNo;
      const title = stringValue(row.title);
      if (!title) throw new Error('title is required');
      if (galleryOverride && galleryId !== galleryOverride)
        throw new Error('gallery override mismatch');
      if (galleryId !== parsed.galleryId || postId.replace(/^0+(?=\d)/, '') !== parsed.postNo) {
        throw new Error('galleryId/postId does not match URL');
      }
      const keyword = stringValue(row.keyword);
      const searchType = stringValue(row.searchType);
      const searchStep = stringValue(row.searchStep);
      const dateLabel = stringValue(row.date);
      records.push({
        ...parsed,
        title: title.slice(0, 500),
        matchedKeywords: keyword ? [keyword.slice(0, 100)] : [],
        ...(searchType ? { searchTypes: [searchType.slice(0, 100)] } : {}),
        ...(searchStep ? { searchSteps: [searchStep.slice(0, 100)] } : {}),
        ...(dateLabel ? { dateLabel: dateLabel.slice(0, 100) } : {}),
        ...(nonnegativeInteger(row.views) === undefined
          ? {}
          : { views: nonnegativeInteger(row.views) }),
        ...(nonnegativeInteger(row.recommends) === undefined
          ? {}
          : { recommends: nonnegativeInteger(row.recommends) }),
        ...(nonnegativeInteger(row.commentCount) === undefined
          ? {}
          : { commentCount: nonnegativeInteger(row.commentCount) }),
        source: format === 'csv' ? 'deep_search_export' : 'user_import',
        capturedAt,
      });
    } catch (error) {
      diagnostics.push({
        row: index + (format === 'csv' ? 2 : 1),
        code: 'ROW_REJECTED',
        message: error instanceof Error ? error.message : 'invalid row',
      });
    }
  }
  return { records, rejected: diagnostics.length, diagnostics: diagnostics.slice(0, 100) };
}
