import { parseWordList } from "./parser.js";
import type { ImportWordListInput, ImportWordListResult } from "./types.js";
import type { VocabStore } from "./store.js";
import { ValidationError } from "../utils/validation.js";

export function importWordList(store: VocabStore, input: ImportWordListInput): ImportWordListResult {
  const parsed = parseWordList(input.text);
  if (parsed.words.length === 0) {
    const first = parsed.errors[0]?.message ?? "No valid vocabulary rows were found.";
    throw new ValidationError(first);
  }
  store.logger.debug("word list parsed", {
    sourceSet: input.sourceSet,
    parsedCount: parsed.words.length,
    parseErrorCount: parsed.errors.length,
  });
  const result = store.importParsedWords(parsed.words, {
    ...(input.sourceCategory !== undefined && { sourceCategory: input.sourceCategory }),
    sourceSet: input.sourceSet,
    defaultStatus: input.defaultStatus ?? "unseen",
    duplicatePolicy: input.duplicatePolicy ?? "skip",
  });
  store.logger.debug("word list imported", {
    sourceSet: input.sourceSet,
    importedCount: result.imported,
    duplicateCount: result.skippedDuplicates,
    conflictCount: result.conflicts,
  });
  return {
    ...result,
    ...(parsed.errors.length > 0 && { parseErrors: parsed.errors }),
  };
}
