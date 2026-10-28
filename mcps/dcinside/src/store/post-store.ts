import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { DomainError } from '../errors.js';

export const MAX_SERIALIZED_RECORD_BYTES = 250 * 1_024;

const storedCommentSchema = z
  .object({
    text: z.string().min(1).max(5_000),
    commentId: z.string().max(200).optional(),
    postedAt: z.string().max(100).optional(),
    parentCommentId: z.string().max(200).optional(),
  })
  .strict();

export const postRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    source: z.literal('user_import'),
    canonicalUrl: z.string().url(),
    galleryId: z.string().min(1).max(64),
    galleryType: z.enum(['major', 'minor', 'mini']),
    postNo: z.string().regex(/^\d+$/),
    title: z.string().min(1).max(500),
    bodyText: z.string().max(100_000),
    comments: z.array(storedCommentSchema).max(100),
    note: z.string().max(2_000).optional(),
    importedAt: z.string().datetime({ offset: true }),
    imageUrls: z.array(z.string().url()).max(100).optional(),
    parserVersion: z.string().max(100).optional(),
  })
  .strict();

export type StoredPostRecord = z.infer<typeof postRecordSchema>;
export type StoredComment = z.infer<typeof storedCommentSchema>;

export function recordFilenameForCanonicalUrl(canonicalUrl: string): string {
  return `${createHash('sha256').update(canonicalUrl, 'utf8').digest('hex')}.json`;
}

function storageError(): DomainError {
  return new DomainError('STORAGE_ERROR', 'Local post storage operation failed.', false);
}

function corruptError(): DomainError {
  return new DomainError(
    'DATA_CORRUPT',
    'The locally stored post record is invalid or corrupt.',
    false,
  );
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code
  );
}

export class PostStore {
  private readonly postsDirectory: string;
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(readonly dataDirectory: string) {
    this.postsDirectory = join(dataDirectory, 'posts');
  }

  async save(record: StoredPostRecord): Promise<void> {
    const validated = postRecordSchema.safeParse(record);
    if (!validated.success) {
      throw new DomainError('INPUT_INVALID', 'Imported post record is invalid.', false);
    }
    const serialized = `${JSON.stringify(validated.data, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_SERIALIZED_RECORD_BYTES) {
      throw new DomainError('INPUT_INVALID', 'Serialized import exceeds the 250 KiB limit.', false);
    }

    const filename = recordFilenameForCanonicalUrl(record.canonicalUrl);
    const previous = this.writeQueues.get(filename) ?? Promise.resolve();
    const queued = previous
      .catch(() => undefined)
      .then(async () => {
        await this.ensureDirectories();
        const destination = join(this.postsDirectory, filename);
        const temporary = join(
          this.postsDirectory,
          `.${filename}.${process.pid}.${randomUUID()}.tmp`,
        );
        try {
          await writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
          if (process.platform !== 'win32') await chmod(temporary, 0o600);
          await rename(temporary, destination);
          if (process.platform !== 'win32') await chmod(destination, 0o600);
        } catch {
          await unlink(temporary).catch(() => undefined);
          throw storageError();
        }
      });
    this.writeQueues.set(filename, queued);
    try {
      await queued;
    } finally {
      if (this.writeQueues.get(filename) === queued) this.writeQueues.delete(filename);
    }
  }

  async get(canonicalUrl: string): Promise<StoredPostRecord | undefined> {
    const filename = recordFilenameForCanonicalUrl(canonicalUrl);
    let serialized: string;
    try {
      serialized = await readFile(join(this.postsDirectory, filename), 'utf8');
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return undefined;
      throw storageError();
    }

    let value: unknown;
    try {
      value = JSON.parse(serialized) as unknown;
    } catch {
      throw corruptError();
    }
    const parsed = postRecordSchema.safeParse(value);
    if (!parsed.success || parsed.data.canonicalUrl !== canonicalUrl) throw corruptError();
    return parsed.data;
  }

  private async ensureDirectories(): Promise<void> {
    try {
      await mkdir(this.dataDirectory, { recursive: true, mode: 0o700 });
      await mkdir(this.postsDirectory, { recursive: true, mode: 0o700 });
      if (process.platform !== 'win32') {
        await chmod(this.dataDirectory, 0o700);
        await chmod(this.postsDirectory, 0o700);
      }
    } catch {
      throw storageError();
    }
  }
}
