import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { GalleryType } from '../core/dc-url.js';
import { DomainError } from '../errors.js';

const searchRecordSchema = z
  .object({
    canonicalUrl: z.string().url(),
    galleryId: z.string().min(1).max(64),
    galleryType: z.enum(['major', 'minor', 'mini']),
    postNo: z.string().regex(/^\d+$/),
    title: z.string().min(1).max(500),
    snippet: z.string().max(2_000).optional(),
    dateLabel: z.string().max(100).optional(),
    views: z.number().int().nonnegative().optional(),
    recommends: z.number().int().nonnegative().optional(),
    commentCount: z.number().int().nonnegative().optional(),
    matchedKeywords: z.array(z.string().min(1).max(100)).max(100),
    searchTypes: z.array(z.string().max(100)).max(100).optional(),
    searchSteps: z.array(z.string().max(100)).max(100).optional(),
    source: z.enum(['deep_search_export', 'user_import']),
    capturedAt: z.string().datetime({ offset: true }),
  })
  .strict();

const indexFileSchema = z
  .object({ schemaVersion: z.literal(1), records: z.array(searchRecordSchema).max(10_000) })
  .strict();

export type SearchIndexRecord = z.infer<typeof searchRecordSchema>;

export interface SearchIndexQuery {
  query: string;
  galleryId?: string;
  galleryType?: GalleryType;
  keywords?: string[];
  sort: 'relevance' | 'latest';
  limit: number;
}

function storageError(): DomainError {
  return new DomainError('STORAGE_ERROR', 'Local search index operation failed.', false);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function mergeRecord(current: SearchIndexRecord, next: SearchIndexRecord): SearchIndexRecord {
  return {
    ...current,
    ...next,
    matchedKeywords: unique([...current.matchedKeywords, ...next.matchedKeywords]),
    searchTypes: unique([...(current.searchTypes ?? []), ...(next.searchTypes ?? [])]),
    searchSteps: unique([...(current.searchSteps ?? []), ...(next.searchSteps ?? [])]),
  };
}

export class SearchIndexStore {
  private readonly directory: string;
  private readonly filename: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly dataDirectory: string) {
    this.directory = join(dataDirectory, 'search-index');
    this.filename = join(this.directory, 'index.json');
  }

  async upsert(
    incoming: SearchIndexRecord[],
    replace = false,
  ): Promise<{ accepted: number; duplicates: number; total: number }> {
    let result = { accepted: 0, duplicates: 0, total: 0 };
    const operation = this.queue
      .catch(() => undefined)
      .then(async () => {
        const current = replace ? [] : await this.read();
        const records = new Map(current.map((record) => [record.canonicalUrl, record]));
        let accepted = 0;
        let duplicates = 0;
        for (const candidate of incoming) {
          const parsed = searchRecordSchema.safeParse(candidate);
          if (!parsed.success) {
            throw new DomainError('INPUT_INVALID', 'Imported search record is invalid.', false);
          }
          const existing = records.get(parsed.data.canonicalUrl);
          if (existing) {
            duplicates += 1;
            records.set(parsed.data.canonicalUrl, mergeRecord(existing, parsed.data));
          } else {
            accepted += 1;
            records.set(parsed.data.canonicalUrl, parsed.data);
          }
        }
        await this.write([...records.values()]);
        result = { accepted, duplicates, total: records.size };
      });
    this.queue = operation;
    await operation;
    return result;
  }

  async listGallery(
    galleryId: string,
    galleryType: GalleryType | undefined,
    page: number,
    limit: number,
  ): Promise<{ items: SearchIndexRecord[]; total: number }> {
    const filtered = (await this.read())
      .filter(
        (record) =>
          record.galleryId === galleryId &&
          (galleryType === undefined || record.galleryType === galleryType),
      )
      .sort((left, right) => Number(right.postNo) - Number(left.postNo));
    const offset = (page - 1) * limit;
    return { items: filtered.slice(offset, offset + limit), total: filtered.length };
  }

  async count(): Promise<number> {
    return (await this.read()).length;
  }

  async search(query: SearchIndexQuery): Promise<SearchIndexRecord[]> {
    const phrase = query.query.toLocaleLowerCase('ko-KR');
    const keywords = unique(query.keywords ?? []).map((value) => value.toLocaleLowerCase('ko-KR'));
    const scored = (await this.read())
      .filter(
        (record) =>
          (query.galleryId === undefined || record.galleryId === query.galleryId) &&
          (query.galleryType === undefined || record.galleryType === query.galleryType),
      )
      .map((record, providerRank) => {
        const title = record.title.toLocaleLowerCase('ko-KR');
        const snippet = (record.snippet ?? '').toLocaleLowerCase('ko-KR');
        const recordKeywords = record.matchedKeywords.map((value) =>
          value.toLocaleLowerCase('ko-KR'),
        );
        const matched = keywords.filter(
          (keyword) =>
            title.includes(keyword) ||
            snippet.includes(keyword) ||
            recordKeywords.includes(keyword),
        );
        const phraseMatched =
          title.includes(phrase) ||
          snippet.includes(phrase) ||
          recordKeywords.some((value) => value.includes(phrase));
        let score = query.galleryId === record.galleryId ? 100 : 0;
        if (title.includes(phrase)) score += 50;
        else if (snippet.includes(phrase)) score += 20;
        else if (recordKeywords.some((value) => value.includes(phrase))) score += 15;
        score += matched.length * 10;
        return { record, providerRank, score, matched, phraseMatched };
      })
      .filter(({ phraseMatched, matched }) => phraseMatched || matched.length > 0);

    scored.sort((left, right) => {
      if (query.sort === 'latest') {
        if (left.record.galleryId === right.record.galleryId) {
          const byPost = Number(right.record.postNo) - Number(left.record.postNo);
          if (byPost !== 0) return byPost;
        }
      } else if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.providerRank - right.providerRank;
    });
    return scored.slice(0, query.limit).map(({ record, matched }) => ({
      ...record,
      matchedKeywords: unique([...record.matchedKeywords, ...matched]),
    }));
  }

  private async read(): Promise<SearchIndexRecord[]> {
    let raw: string;
    try {
      raw = await readFile(this.filename, 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
      throw storageError();
    }
    try {
      const parsed = indexFileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) throw new Error('invalid');
      return parsed.data.records;
    } catch {
      throw new DomainError('DATA_CORRUPT', 'The local search index is invalid.', false);
    }
  }

  private async write(records: SearchIndexRecord[]): Promise<void> {
    const temporary = join(this.directory, `.index.${process.pid}.${randomUUID()}.tmp`);
    try {
      await mkdir(this.dataDirectory, { recursive: true, mode: 0o700 });
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const data = `${JSON.stringify({ schemaVersion: 1, records }, null, 2)}\n`;
      await writeFile(temporary, data, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      if (process.platform !== 'win32') await chmod(temporary, 0o600);
      await rename(temporary, this.filename);
      if (process.platform !== 'win32') await chmod(this.filename, 0o600);
    } catch {
      await unlink(temporary).catch(() => undefined);
      throw storageError();
    }
  }
}
