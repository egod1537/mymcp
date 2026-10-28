import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { classifyDuplicate } from "./duplicate.js";
import { selectDailyWords } from "./distributor.js";
import { createNormalizedKey, keyField } from "./normalize.js";
import type {
  DailyWordsInput,
  DailyWordsResult,
  DistributionHistoryInput,
  DistributionHistoryItem,
  DuplicatePolicy,
  GetWordsResult,
  ImportWordListResult,
  JapaneseWord,
  ParsedWord,
  ResetDistributionInput,
  SearchWordsInput,
  WordFilters,
  WordStatus,
} from "./types.js";
import { formatLocalDate, formatLocalIso } from "../utils/date.js";
import { logger, type Logger } from "../utils/logger.js";
import { ValidationError, readPositiveInteger } from "../utils/validation.js";

interface WordRow extends Record<string, SQLInputValue> {
  id: string;
  jp: string;
  reading: string;
  meaning_ko: string;
  nuance: string | null;
  source_category: string | null;
  source_set: string | null;
  source_index: number | null;
  normalized_key: string;
  status: WordStatus;
  imported_at: string;
  distributed_at: string | null;
  notes: string | null;
}

export interface VocabStoreOptions {
  dbPath?: string;
  logger?: Logger;
  now?: () => Date;
  random?: () => number;
  defaultDailyCount?: number;
}

function packageRoot(): string {
  return fileURLToPath(new URL("../../", import.meta.url));
}

export function resolveDatabasePath(configured = process.env.JAPANESE_VOCAB_DB_PATH ?? "./data/vocab.db"): string {
  if (configured === ":memory:") return configured;
  return resolve(packageRoot(), configured);
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

function rowToWord(row: WordRow): JapaneseWord {
  return {
    id: row.id,
    jp: row.jp,
    reading: row.reading,
    meaningKo: row.meaning_ko,
    ...(row.nuance !== null && { nuance: row.nuance }),
    ...(row.source_category !== null && { sourceCategory: row.source_category }),
    ...(row.source_set !== null && { sourceSet: row.source_set }),
    ...(row.source_index !== null && { sourceIndex: row.source_index }),
    normalizedKey: row.normalized_key,
    status: row.status,
    importedAt: row.imported_at,
    ...(row.distributed_at !== null && { distributedAt: row.distributed_at }),
    ...(row.notes !== null && { notes: row.notes }),
  };
}

function asWordRows(rows: Record<string, unknown>[]): JapaneseWord[] {
  return rows.map((row) => rowToWord(row as WordRow));
}

export class VocabStore {
  private readonly db: DatabaseSync;
  private readonly log: Logger;
  private readonly now: () => Date;
  private readonly random: () => number;
  readonly defaultDailyCount: number;

  constructor(options: VocabStoreOptions = {}) {
    const dbPath = resolveDatabasePath(options.dbPath);
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.log = options.logger ?? logger;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.defaultDailyCount = options.defaultDailyCount ?? readPositiveInteger(
      process.env.JAPANESE_VOCAB_DEFAULT_DAILY_COUNT,
      14,
      "JAPANESE_VOCAB_DEFAULT_DAILY_COUNT",
    );
    this.initialize();
  }

  get logger(): Logger {
    return this.log;
  }

  close(): void {
    this.db.close();
  }

  private initialize(): void {
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS words (
        id TEXT PRIMARY KEY,
        jp TEXT NOT NULL,
        reading TEXT NOT NULL,
        meaning_ko TEXT NOT NULL,
        nuance TEXT,
        source_category TEXT,
        source_set TEXT,
        source_index INTEGER,
        normalized_key TEXT NOT NULL,
        jp_key TEXT NOT NULL,
        reading_key TEXT NOT NULL,
        nuance_key TEXT NOT NULL,
        meaning_key TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('unseen', 'distributed')),
        imported_at TEXT NOT NULL,
        distributed_at TEXT,
        notes TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_words_identity
        ON words (jp_key, reading_key, nuance_key);
      CREATE INDEX IF NOT EXISTS idx_words_status_imported
        ON words (status, imported_at, source_index);
      CREATE INDEX IF NOT EXISTS idx_words_source
        ON words (source_category, source_set);

      CREATE TABLE IF NOT EXISTS distribution_batches (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        created_at TEXT NOT NULL,
        source_category TEXT,
        source_set TEXT,
        batch_key TEXT NOT NULL,
        requested_count INTEGER NOT NULL,
        distributed_count INTEGER NOT NULL,
        strategy TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_batches_date_key
        ON distribution_batches (date, batch_key, created_at);

      CREATE TABLE IF NOT EXISTS distribution_batch_items (
        batch_id TEXT NOT NULL REFERENCES distribution_batches(id) ON DELETE CASCADE,
        word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        PRIMARY KEY (batch_id, word_id)
      );

      CREATE INDEX IF NOT EXISTS idx_batch_items_word
        ON distribution_batch_items (word_id);
    `);
  }

  importParsedWords(
    parsedWords: ParsedWord[],
    options: {
      sourceCategory?: string;
      sourceSet: string;
      defaultStatus: WordStatus;
      duplicatePolicy: DuplicatePolicy;
    },
  ): ImportWordListResult {
    const imported: JapaneseWord[] = [];
    const duplicateWords: JapaneseWord[] = [];
    const conflictWords: NonNullable<ImportWordListResult["conflictWords"]> = [];
    let skippedDuplicates = 0;
    const importedAt = formatLocalIso(this.now());

    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const incoming of parsedWords) {
        const candidates = this.findIdentityCandidates(incoming);
        const classification = classifyDuplicate(incoming, candidates);
        if (classification.kind === "conflict") {
          conflictWords.push({ incoming, existing: classification.matches });
          continue;
        }
        if (classification.kind === "duplicate" && options.duplicatePolicy !== "keep") {
          skippedDuplicates += 1;
          if (options.duplicatePolicy === "report") duplicateWords.push(...classification.matches);
          continue;
        }

        const word: JapaneseWord = {
          id: randomUUID(),
          jp: incoming.jp,
          reading: incoming.reading,
          meaningKo: incoming.meaningKo,
          ...(incoming.nuance && { nuance: incoming.nuance }),
          ...(options.sourceCategory && { sourceCategory: options.sourceCategory }),
          sourceSet: options.sourceSet,
          ...(incoming.sourceIndex !== undefined && { sourceIndex: incoming.sourceIndex }),
          normalizedKey: createNormalizedKey(incoming),
          status: options.defaultStatus,
          importedAt,
          ...(options.defaultStatus === "distributed" && { distributedAt: importedAt }),
          ...(incoming.notes && { notes: incoming.notes }),
        };
        this.insertWord(word);
        imported.push(word);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    return {
      imported: imported.length,
      skippedDuplicates,
      conflicts: conflictWords.length,
      words: imported,
      ...(duplicateWords.length > 0 && { duplicateWords }),
      ...(conflictWords.length > 0 && { conflictWords }),
    };
  }

  private findIdentityCandidates(word: ParsedWord): JapaneseWord[] {
    return asWordRows(this.db.prepare(`
      SELECT * FROM words WHERE jp_key = ? AND reading_key = ?
    `).all(keyField(word.jp), keyField(word.reading)));
  }

  private insertWord(word: JapaneseWord): void {
    this.db.prepare(`
      INSERT INTO words (
        id, jp, reading, meaning_ko, nuance, source_category, source_set, source_index,
        normalized_key, jp_key, reading_key, nuance_key, meaning_key,
        status, imported_at, distributed_at, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      word.id,
      word.jp,
      word.reading,
      word.meaningKo,
      word.nuance ?? null,
      word.sourceCategory ?? null,
      word.sourceSet ?? null,
      word.sourceIndex ?? null,
      word.normalizedKey,
      keyField(word.jp),
      keyField(word.reading),
      keyField(word.nuance),
      keyField(word.meaningKo),
      word.status,
      word.importedAt,
      word.distributedAt ?? null,
      word.notes ?? null,
    );
  }

  getWords(filters: WordFilters = {}): GetWordsResult {
    const conditions: string[] = [];
    const parameters: SQLInputValue[] = [];
    if (filters.sourceCategory !== undefined) {
      conditions.push("source_category = ?");
      parameters.push(filters.sourceCategory);
    }
    if (filters.sourceSet !== undefined) {
      conditions.push("source_set = ?");
      parameters.push(filters.sourceSet);
    }
    if (filters.status !== undefined) {
      conditions.push("status = ?");
      parameters.push(filters.status);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const totalRow = this.db.prepare(`SELECT COUNT(*) AS total FROM words ${where}`).get(...parameters);
    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;
    const words = asWordRows(this.db.prepare(`
      SELECT * FROM words ${where}
      ORDER BY imported_at ASC, rowid ASC
      LIMIT ? OFFSET ?
    `).all(...parameters, limit, offset));
    return { words, total: Number(totalRow?.total ?? 0) };
  }

  getWordsByIds(ids: string[]): JapaneseWord[] {
    if (ids.length === 0) return [];
    const words = asWordRows(this.db.prepare(
      `SELECT * FROM words WHERE id IN (${placeholders(ids.length)})`,
    ).all(...ids));
    const byId = new Map(words.map((word) => [word.id, word]));
    return ids.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []);
  }

  searchWords(input: SearchWordsInput): JapaneseWord[] {
    const fieldMap = {
      jp: "jp",
      reading: "reading",
      meaningKo: "meaning_ko",
      nuance: "nuance",
      sourceCategory: "source_category",
      sourceSet: "source_set",
    } as const;
    const fields = input.fields?.length ? input.fields : Object.keys(fieldMap) as Array<keyof typeof fieldMap>;
    const escaped = input.query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
    const conditions = fields.map((field) => `COALESCE(${fieldMap[field]}, '') LIKE ? ESCAPE '\\'`);
    const parameters = fields.map(() => `%${escaped}%`);
    return asWordRows(this.db.prepare(`
      SELECT * FROM words WHERE ${conditions.join(" OR ")}
      ORDER BY imported_at ASC, rowid ASC
      LIMIT ?
    `).all(...parameters, input.limit ?? 50));
  }

  getDailyWords(input: DailyWordsInput = {}): DailyWordsResult {
    const count = input.count ?? this.defaultDailyCount;
    const strategy = input.strategy ?? "oldest_first";
    const markDistributed = input.markDistributed ?? true;
    const reuseToday = (input.reuseToday ?? true) && !(input.forceNewBatch ?? false);
    const date = formatLocalDate(this.now());
    const batchKey = JSON.stringify({
      count,
      sourceCategory: input.sourceCategory ?? null,
      sourceSet: input.sourceSet ?? null,
      excludeSourceSets: [...(input.excludeSourceSets ?? [])].sort(),
      strategy,
    });

    if (markDistributed && reuseToday) {
      const existing = this.db.prepare(`
        SELECT id, created_at, distributed_count FROM distribution_batches
        WHERE date = ? AND batch_key = ? ORDER BY created_at DESC LIMIT 1
      `).get(date, batchKey);
      if (existing && typeof existing.id === "string" && typeof existing.created_at === "string") {
        const words = this.getBatchWords(existing.id);
        if (words.length > 0 && words.length === Number(existing.distributed_count)) {
          return {
            batchId: existing.id,
            date,
            requestedCount: count,
            returnedCount: words.length,
            words,
            remainingUnseen: this.countUnseen(input),
            distributedAt: existing.created_at,
            reusedBatch: true,
          };
        }
      }
    }

    const candidates = this.getUnseenCandidates(input);
    const selected = selectDailyWords(candidates, count, strategy, this.random);
    if (!markDistributed || selected.length === 0) {
      return {
        date,
        requestedCount: count,
        returnedCount: selected.length,
        words: selected,
        remainingUnseen: candidates.length,
        reusedBatch: false,
      };
    }

    const batchId = randomUUID();
    const distributedAt = formatLocalIso(this.now());
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO distribution_batches (
          id, date, created_at, source_category, source_set, batch_key,
          requested_count, distributed_count, strategy
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        batchId,
        date,
        distributedAt,
        input.sourceCategory ?? null,
        input.sourceSet ?? null,
        batchKey,
        count,
        selected.length,
        strategy,
      );
      const insertItem = this.db.prepare(`
        INSERT INTO distribution_batch_items (batch_id, word_id, position) VALUES (?, ?, ?)
      `);
      selected.forEach((word, index) => insertItem.run(batchId, word.id, index));
      this.db.prepare(`
        UPDATE words SET status = 'distributed', distributed_at = ?
        WHERE id IN (${placeholders(selected.length)})
      `).run(distributedAt, ...selected.map((word) => word.id));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    const words = selected.map((word) => ({ ...word, status: "distributed" as const, distributedAt }));
    return {
      batchId,
      date,
      requestedCount: count,
      returnedCount: words.length,
      words,
      remainingUnseen: this.countUnseen(input),
      distributedAt,
      reusedBatch: false,
    };
  }

  private dailyConditions(input: DailyWordsInput): { sql: string; parameters: SQLInputValue[] } {
    const conditions = ["status = 'unseen'"];
    const parameters: SQLInputValue[] = [];
    if (input.sourceCategory !== undefined) {
      conditions.push("source_category = ?");
      parameters.push(input.sourceCategory);
    }
    if (input.sourceSet !== undefined) {
      conditions.push("source_set = ?");
      parameters.push(input.sourceSet);
    }
    if (input.excludeSourceSets?.length) {
      conditions.push(`(source_set IS NULL OR source_set NOT IN (${placeholders(input.excludeSourceSets.length)}))`);
      parameters.push(...input.excludeSourceSets);
    }
    return { sql: conditions.join(" AND "), parameters };
  }

  private getUnseenCandidates(input: DailyWordsInput): JapaneseWord[] {
    const { sql, parameters } = this.dailyConditions(input);
    return asWordRows(this.db.prepare(`
      SELECT * FROM words WHERE ${sql}
      ORDER BY imported_at ASC, rowid ASC
    `).all(...parameters));
  }

  private countUnseen(input: DailyWordsInput): number {
    const { sql, parameters } = this.dailyConditions(input);
    const row = this.db.prepare(`SELECT COUNT(*) AS total FROM words WHERE ${sql}`).get(...parameters);
    return Number(row?.total ?? 0);
  }

  private getBatchWords(batchId: string): JapaneseWord[] {
    return asWordRows(this.db.prepare(`
      SELECT words.* FROM distribution_batch_items AS items
      JOIN words ON words.id = items.word_id
      WHERE items.batch_id = ? ORDER BY items.position ASC
    `).all(batchId));
  }

  getDistributionHistory(input: DistributionHistoryInput = {}): DistributionHistoryItem[] {
    const conditions: string[] = [];
    const parameters: SQLInputValue[] = [];
    if (input.from !== undefined) {
      conditions.push("b.date >= ?");
      parameters.push(input.from);
    }
    if (input.to !== undefined) {
      conditions.push("b.date <= ?");
      parameters.push(input.to);
    }
    if (input.sourceCategory !== undefined) {
      conditions.push("w.source_category = ?");
      parameters.push(input.sourceCategory);
    }
    if (input.sourceSet !== undefined) {
      conditions.push("w.source_set = ?");
      parameters.push(input.sourceSet);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db.prepare(`
      SELECT b.date AS batch_date, b.id AS batch_id, i.position, w.*
      FROM distribution_batches b
      JOIN distribution_batch_items i ON i.batch_id = b.id
      JOIN words w ON w.id = i.word_id
      ${where}
      ORDER BY b.date DESC, b.created_at DESC, i.position ASC
    `).all(...parameters);

    const grouped = new Map<string, Map<string, JapaneseWord>>();
    for (const row of rows) {
      const date = String(row.batch_date);
      if (!grouped.has(date)) grouped.set(date, new Map());
      const word = rowToWord(row as WordRow);
      grouped.get(date)!.set(word.id, word);
    }
    return [...grouped.entries()]
      .slice(0, input.limit ?? 30)
      .map(([date, words]) => ({ date, words: [...words.values()] }));
  }

  resetDistribution(input: ResetDistributionInput): number {
    const hasFilters = Boolean(input.wordIds?.length || input.sourceCategory || input.sourceSet);
    if (!input.all && !hasFilters) {
      throw new ValidationError("Specify wordIds, sourceCategory, sourceSet, or all=true.");
    }
    if (input.all && hasFilters) {
      throw new ValidationError("all=true cannot be combined with wordIds or source filters.");
    }

    const conditions = ["status = 'distributed'"];
    const parameters: SQLInputValue[] = [];
    if (!input.all) {
      if (input.wordIds?.length) {
        conditions.push(`id IN (${placeholders(input.wordIds.length)})`);
        parameters.push(...input.wordIds);
      }
      if (input.sourceCategory) {
        conditions.push("source_category = ?");
        parameters.push(input.sourceCategory);
      }
      if (input.sourceSet) {
        conditions.push("source_set = ?");
        parameters.push(input.sourceSet);
      }
    }
    const rows = this.db.prepare(`SELECT id FROM words WHERE ${conditions.join(" AND ")}`).all(...parameters);
    const ids = rows.map((row) => String(row.id));
    if (ids.length === 0) return 0;

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`DELETE FROM distribution_batch_items WHERE word_id IN (${placeholders(ids.length)})`).run(...ids);
      this.db.exec(`DELETE FROM distribution_batches
        WHERE NOT EXISTS (
          SELECT 1 FROM distribution_batch_items i WHERE i.batch_id = distribution_batches.id
        )`);
      this.db.prepare(`
        UPDATE words SET status = 'unseen', distributed_at = NULL
        WHERE id IN (${placeholders(ids.length)})
      `).run(...ids);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return ids.length;
  }
}
