import { z } from "zod";

const idSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{1,100}$/);
const shortTextSchema = z.string().trim().min(1).max(200);
const stringListSchema = z.array(shortTextSchema).max(50);

const remoteWordSchema = z.strictObject({
  term: z.string().trim().min(1).max(200),
  reading: z.string().trim().min(1).max(200).optional(),
  primaryMeaning: z.string().trim().min(1).max(2_000),
  meanings: z.array(z.string().trim().min(1).max(2_000)).max(50).optional(),
  nuance: z.string().trim().min(1).max(1_000).optional(),
  partOfSpeech: stringListSchema.optional(),
  jlptLevels: stringListSchema.optional(),
  years: z.array(z.number().int().min(1900).max(2200)).max(50).optional(),
  categories: stringListSchema.optional(),
  relatedTerms: stringListSchema.optional(),
  examples: z
    .array(
      z.strictObject({
        ja: z.string().trim().min(1).max(2_000),
        ko: z.string().trim().min(1).max(2_000).optional(),
      }),
    )
    .max(50)
    .optional(),
  tags: stringListSchema.optional(),
  status: z.enum(["ready", "needs-review"]).default("ready"),
});

export const listBooksInputSchema = z.strictObject({
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).max(100_000).default(0),
});

export const listFoldersInputSchema = z.strictObject({});

export const getBookEntriesInputSchema = z.strictObject({
  bookId: idSchema,
  cursor: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER).default(-1),
  limit: z.number().int().min(1).max(200).default(50),
});

export const searchRemoteInputSchema = z
  .strictObject({
    query: z.string().trim().min(1).max(500),
    scope: z.enum(["words", "books"]).default("words"),
    status: z.enum(["needs-review"]).optional(),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .superRefine((value, context) => {
    if (value.status && value.scope !== "words") {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "status is supported only for word searches.",
      });
    }
  });

export const getStudyCardsInputSchema = z.strictObject({
  mode: z.enum(["unseen", "due", "weak"]).default("unseen"),
  includeReview: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(14),
  seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  bookIds: z.array(idSchema).max(50).optional(),
  minStar: z.number().int().min(1).max(5).optional(),
  bookmarks: z.boolean().optional(),
  partOfSpeech: z.string().trim().min(1).max(100).optional(),
  chunk: z.number().int().min(1).max(10_000).optional(),
});

export const importRemoteWordsInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(500),
  category: z.string().trim().min(1).max(200).optional(),
  folderId: idSchema.optional(),
  words: z
    .array(
      z.strictObject({
        term: z.string().trim().min(1).max(500),
        reading: z.string().trim().min(1).max(500),
        primaryMeaning: z.string().trim().min(1).max(2_000),
        nuance: z.string().trim().min(1).max(1_000).optional(),
      }),
    )
    .min(1)
    .max(200),
  confirm: z.literal(true).describe("Must be true because this writes to the JLPT service."),
});

export const createFolderInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  parentId: idSchema.optional(),
  confirm: z.literal(true).describe("Must be true because this writes to the JLPT service."),
});

export const createBookInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(500),
  category: z.string().trim().min(1).max(200).optional(),
  folderId: idSchema.optional(),
  confirm: z.literal(true).describe("Must be true because this writes to the JLPT service."),
});

export const addWordsInputSchema = z.strictObject({
  bookId: idSchema,
  words: z.array(remoteWordSchema).min(1).max(200),
  confirm: z.literal(true).describe("Must be true because this writes to the JLPT service."),
});

export const moveBooksInputSchema = z.strictObject({
  bookIds: z.array(idSchema).min(1).max(50).refine((ids) => new Set(ids).size === ids.length, {
    message: "bookIds must not contain duplicates.",
  }),
  folderId: idSchema.nullable().default(null),
  confirm: z.literal(true).describe("Must be true because this writes to the JLPT service."),
});

export const updateFolderInputSchema = z
  .strictObject({
    folderId: idSchema,
    name: z.string().trim().min(1).max(200).optional(),
    parentId: idSchema.nullable().optional(),
    pinned: z.boolean().optional(),
    confirm: z.literal(true).describe("Must be true because this writes to the JLPT service."),
  })
  .refine(
    (value) =>
      value.name !== undefined || value.parentId !== undefined || value.pinned !== undefined,
    { message: "At least one folder field must be supplied." },
  );

export const updateBookInputSchema = z
  .strictObject({
    bookId: idSchema,
    title: z.string().trim().min(1).max(500).optional(),
    category: z.string().trim().min(1).max(200).nullable().optional(),
    favorite: z.boolean().optional(),
    folderId: idSchema.nullable().optional(),
    confirm: z.literal(true).describe("Must be true because this writes to the JLPT service."),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.category !== undefined ||
      value.favorite !== undefined ||
      value.folderId !== undefined,
    { message: "At least one book field must be supplied." },
  );

export const updateWordInputSchema = z
  .strictObject({
    bookId: idSchema,
    entryId: idSchema,
    term: z.string().trim().min(1).max(200).optional(),
    reading: z.string().trim().min(1).max(200).nullable().optional(),
    primaryMeaning: z.string().trim().min(1).max(2_000).optional(),
    meanings: z.array(z.string().trim().min(1).max(2_000)).max(50).optional(),
    nuance: z.string().trim().min(1).max(1_000).nullable().optional(),
    partOfSpeech: stringListSchema.optional(),
    jlptLevels: stringListSchema.optional(),
    years: z.array(z.number().int().min(1900).max(2200)).max(50).optional(),
    categories: stringListSchema.optional(),
    relatedTerms: stringListSchema.optional(),
    examples: z
      .array(
        z.strictObject({
          ja: z.string().trim().min(1).max(2_000),
          ko: z.string().trim().min(1).max(2_000).nullable().optional(),
        }),
      )
      .max(50)
      .optional(),
    tags: stringListSchema.optional(),
    status: z.enum(["ready", "needs-review"]).optional(),
    identityPolicy: z.enum(["fork", "same"]).default("fork"),
    confirm: z.literal(true).describe("Must be true because this writes to the JLPT service."),
  })
  .refine(
    (value) =>
      value.term !== undefined ||
      value.reading !== undefined ||
      value.primaryMeaning !== undefined ||
      value.meanings !== undefined ||
      value.nuance !== undefined ||
      value.partOfSpeech !== undefined ||
      value.jlptLevels !== undefined ||
      value.years !== undefined ||
      value.categories !== undefined ||
      value.relatedTerms !== undefined ||
      value.examples !== undefined ||
      value.tags !== undefined ||
      value.status !== undefined,
    { message: "At least one word field must be supplied." },
  );
