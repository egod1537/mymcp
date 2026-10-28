import type { ParsedWord } from "./types.js";

export function cleanField(value: string): string {
  return value.normalize("NFC").trim().replace(/[ \t]+/g, " ");
}

export function keyField(value: string | undefined): string {
  return cleanField(value ?? "").normalize("NFKC").toLocaleLowerCase("ja-JP");
}

export function normalizeParsedWord(word: ParsedWord): ParsedWord {
  const nuance = word.nuance === undefined ? undefined : cleanField(word.nuance);
  const notes = word.notes === undefined ? undefined : cleanField(word.notes);
  return {
    jp: cleanField(word.jp),
    reading: cleanField(word.reading),
    meaningKo: cleanField(word.meaningKo),
    ...(nuance && { nuance }),
    ...(word.sourceIndex !== undefined && { sourceIndex: word.sourceIndex }),
    ...(notes && { notes }),
  };
}

export function createNormalizedKey(word: ParsedWord): string {
  const third = word.nuance ? keyField(word.nuance) : keyField(word.meaningKo);
  return `${keyField(word.jp)}|${keyField(word.reading)}|${third}`;
}

export function splitJapaneseAndNuance(value: string): { jp: string; nuance?: string } {
  const normalized = value.replaceAll("︱", "｜");
  const separatorIndex = normalized.search(/[｜|]/);
  if (separatorIndex < 0) return { jp: cleanField(normalized) };
  const jp = cleanField(normalized.slice(0, separatorIndex));
  const nuance = cleanField(normalized.slice(separatorIndex + 1));
  return { jp, ...(nuance && { nuance }) };
}
