import * as z from "zod/v4";
import { isIsoDate } from "./date.js";

export class ValidationError extends Error {
  override readonly name = "ValidationError";
}

export class ConfigurationError extends Error {
  override readonly name = "ConfigurationError";
}

export function readPositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ConfigurationError(`${name} must be a positive integer.`);
  }
  return parsed;
}

export const wordStatusSchema = z.enum(["unseen", "distributed"]);
export const distributionStrategySchema = z.enum(["oldest_first", "random", "mixed"]);
export const searchFieldSchema = z.enum([
  "jp", "reading", "meaningKo", "nuance", "sourceCategory", "sourceSet",
]);

export const importWordListInputSchema = z.strictObject({
  text: z.string().min(1).max(5_000_000).describe("Vocabulary as plain text, TSV, CSV, Markdown table, or JSON"),
  sourceCategory: z.string().trim().min(1).max(200).optional(),
  sourceSet: z.string().trim().min(1).max(500),
  defaultStatus: wordStatusSchema.optional().describe("Defaults to unseen"),
  duplicatePolicy: z.enum(["skip", "keep", "report"]).optional().describe("Defaults to skip"),
});

export const getDailyWordsInputSchema = z.strictObject({
  count: z.number().int().min(1).max(500).optional().describe("Defaults to JAPANESE_VOCAB_DEFAULT_DAILY_COUNT or 14"),
  sourceCategory: z.string().trim().min(1).max(200).optional(),
  sourceSet: z.string().trim().min(1).max(500).optional(),
  excludeSourceSets: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
  strategy: distributionStrategySchema.optional().describe("Defaults to oldest_first"),
  markDistributed: z.boolean().optional().describe("Defaults to true"),
  reuseToday: z.boolean().optional().describe("Defaults to true"),
  forceNewBatch: z.boolean().optional().describe("Set true only when the user explicitly asks for a different daily set"),
});

export const getWordsInputSchema = z.strictObject({
  sourceCategory: z.string().trim().min(1).max(200).optional(),
  sourceSet: z.string().trim().min(1).max(500).optional(),
  status: wordStatusSchema.optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  offset: z.number().int().min(0).max(10_000_000).optional(),
});

export const searchWordsInputSchema = z.strictObject({
  query: z.string().trim().min(1).max(500),
  fields: z.array(searchFieldSchema).min(1).max(6).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export const distributionHistoryInputSchema = z.strictObject({
  from: z.string().refine(isIsoDate, "from must be YYYY-MM-DD").optional(),
  to: z.string().refine(isIsoDate, "to must be YYYY-MM-DD").optional(),
  sourceCategory: z.string().trim().min(1).max(200).optional(),
  sourceSet: z.string().trim().min(1).max(500).optional(),
  limit: z.number().int().min(1).max(365).optional(),
});

export const resetDistributionInputSchema = z.strictObject({
  wordIds: z.array(z.string().uuid()).min(1).max(1000).optional(),
  sourceCategory: z.string().trim().min(1).max(200).optional(),
  sourceSet: z.string().trim().min(1).max(500).optional(),
  all: z.boolean().optional(),
}).superRefine((value, context) => {
  const hasFilter = Boolean(value.wordIds || value.sourceCategory || value.sourceSet);
  if (!value.all && !hasFilter) context.addIssue({ code: "custom", message: "Specify wordIds, a source filter, or all=true." });
  if (value.all && hasFilter) context.addIssue({ code: "custom", message: "all=true cannot be combined with other filters." });
});

export const flashcardWordSchema = z.strictObject({
  n: z.number().int().min(1).optional(),
  jp: z.string().trim().min(1).max(500),
  rd: z.string().trim().min(1).max(500),
  kr: z.string().trim().min(1).max(2000),
  nuance: z.string().trim().min(1).max(1000).optional(),
});

export const generateFlashcardInputSchema = z.strictObject({
  wordIds: z.array(z.string().uuid()).min(1).max(1000).optional(),
  sourceCategory: z.string().trim().min(1).max(200).optional(),
  sourceSet: z.string().trim().min(1).max(500).optional(),
  words: z.array(flashcardWordSchema).min(1).max(1000).optional(),
  title: z.string().trim().min(1).max(500).optional(),
  shuffleOnStart: z.boolean().optional(),
}).superRefine((value, context) => {
  const selectors = Number(Boolean(value.wordIds)) + Number(Boolean(value.words)) +
    Number(Boolean(value.sourceCategory || value.sourceSet));
  if (selectors !== 1) {
    context.addIssue({
      code: "custom",
      message: "Use exactly one vocabulary source: wordIds, words, or sourceCategory/sourceSet filters.",
    });
  }
});

export const createDailyFlashcardInputSchema = getDailyWordsInputSchema.omit({
  markDistributed: true,
}).extend({
  title: z.string().trim().min(1).max(500).optional(),
  shuffleOnStart: z.boolean().optional(),
});

export const japaneseWordSchema = z.strictObject({
  id: z.string(),
  jp: z.string(),
  reading: z.string(),
  meaningKo: z.string(),
  nuance: z.string().optional(),
  sourceCategory: z.string().optional(),
  sourceSet: z.string().optional(),
  sourceIndex: z.number().int().optional(),
  normalizedKey: z.string(),
  status: wordStatusSchema,
  importedAt: z.string(),
  distributedAt: z.string().optional(),
  notes: z.string().optional(),
});

const parsedWordSchema = z.strictObject({
  jp: z.string(), reading: z.string(), meaningKo: z.string(), nuance: z.string().optional(),
  sourceIndex: z.number().int().optional(), notes: z.string().optional(),
});

const parseErrorSchema = z.strictObject({ line: z.number(), text: z.string(), message: z.string() });

export const importWordListOutputSchema = z.strictObject({
  imported: z.number().int(),
  skippedDuplicates: z.number().int(),
  conflicts: z.number().int(),
  words: z.array(japaneseWordSchema),
  duplicateWords: z.array(japaneseWordSchema).optional(),
  conflictWords: z.array(z.strictObject({
    incoming: parsedWordSchema,
    existing: z.array(japaneseWordSchema),
  })).optional(),
  parseErrors: z.array(parseErrorSchema).optional(),
});

export const dailyWordsOutputSchema = z.strictObject({
  batchId: z.string().optional(),
  date: z.string(),
  requestedCount: z.number().int(),
  returnedCount: z.number().int(),
  words: z.array(japaneseWordSchema),
  remainingUnseen: z.number().int(),
  distributedAt: z.string().optional(),
  reusedBatch: z.boolean(),
});

export const getWordsOutputSchema = z.strictObject({
  words: z.array(japaneseWordSchema),
  total: z.number().int(),
});

export const searchWordsOutputSchema = z.strictObject({
  words: z.array(japaneseWordSchema),
  total: z.number().int(),
});

export const distributionHistoryOutputSchema = z.strictObject({
  items: z.array(z.strictObject({ date: z.string(), words: z.array(japaneseWordSchema) })),
});

export const resetDistributionOutputSchema = z.strictObject({ resetCount: z.number().int() });
export const flashcardOutputSchema = z.strictObject({
  filename: z.string(), html: z.string(), cardCount: z.number().int(),
});
export const dailyFlashcardOutputSchema = dailyWordsOutputSchema.extend({
  filename: z.string(), html: z.string(), cardCount: z.number().int(),
});
