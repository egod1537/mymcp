import { keyField } from "./normalize.js";
import type { JapaneseWord, ParsedWord } from "./types.js";

export type DuplicateClassification =
  | { kind: "none" }
  | { kind: "duplicate"; matches: JapaneseWord[] }
  | { kind: "conflict"; matches: JapaneseWord[] };

export function classifyDuplicate(incoming: ParsedWord, candidates: JapaneseWord[]): DuplicateClassification {
  const sameSense = candidates.filter((existing) =>
    keyField(existing.jp) === keyField(incoming.jp) &&
    keyField(existing.reading) === keyField(incoming.reading) &&
    keyField(existing.nuance) === keyField(incoming.nuance));
  if (sameSense.length === 0) return { kind: "none" };

  const exact = sameSense.filter((existing) => keyField(existing.meaningKo) === keyField(incoming.meaningKo));
  if (exact.length > 0) return { kind: "duplicate", matches: exact };
  return { kind: "conflict", matches: sameSense };
}
