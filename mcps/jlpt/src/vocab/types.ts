export type WordStatus = "unseen" | "distributed";
export type DuplicatePolicy = "skip" | "keep" | "report";
export type DistributionStrategy = "oldest_first" | "random" | "mixed";

export interface JapaneseWord {
  id: string;
  jp: string;
  reading: string;
  meaningKo: string;
  nuance?: string;
  sourceCategory?: string;
  sourceSet?: string;
  sourceIndex?: number;
  normalizedKey: string;
  status: WordStatus;
  importedAt: string;
  distributedAt?: string;
  notes?: string;
}

export interface ParsedWord {
  jp: string;
  reading: string;
  meaningKo: string;
  nuance?: string;
  sourceIndex?: number;
  notes?: string;
}

export interface ParseError {
  line: number;
  text: string;
  message: string;
}

export interface ParsedWordList {
  words: ParsedWord[];
  errors: ParseError[];
}

export interface ConflictWord {
  incoming: ParsedWord;
  existing: JapaneseWord[];
}

export interface ImportWordListInput {
  text: string;
  sourceCategory?: string;
  sourceSet: string;
  defaultStatus?: WordStatus;
  duplicatePolicy?: DuplicatePolicy;
}

export interface ImportWordListResult {
  imported: number;
  skippedDuplicates: number;
  conflicts: number;
  words: JapaneseWord[];
  duplicateWords?: JapaneseWord[];
  conflictWords?: ConflictWord[];
  parseErrors?: ParseError[];
}

export interface WordFilters {
  sourceCategory?: string;
  sourceSet?: string;
  status?: WordStatus;
  limit?: number;
  offset?: number;
}

export interface GetWordsResult {
  words: JapaneseWord[];
  total: number;
}

export type SearchField =
  | "jp"
  | "reading"
  | "meaningKo"
  | "nuance"
  | "sourceCategory"
  | "sourceSet";

export interface SearchWordsInput {
  query: string;
  fields?: SearchField[];
  limit?: number;
}

export interface DailyWordsInput {
  count?: number;
  sourceCategory?: string;
  sourceSet?: string;
  excludeSourceSets?: string[];
  strategy?: DistributionStrategy;
  markDistributed?: boolean;
  reuseToday?: boolean;
  forceNewBatch?: boolean;
}

export interface DailyWordsResult {
  batchId?: string;
  date: string;
  requestedCount: number;
  returnedCount: number;
  words: JapaneseWord[];
  remainingUnseen: number;
  distributedAt?: string;
  reusedBatch: boolean;
}

export interface DistributionBatch {
  id: string;
  date: string;
  createdAt: string;
  sourceCategory?: string;
  sourceSet?: string;
  wordIds: string[];
}

export interface DistributionHistoryInput {
  from?: string;
  to?: string;
  sourceCategory?: string;
  sourceSet?: string;
  limit?: number;
}

export interface DistributionHistoryItem {
  date: string;
  words: JapaneseWord[];
}

export interface ResetDistributionInput {
  wordIds?: string[];
  sourceCategory?: string;
  sourceSet?: string;
  all?: boolean;
}
