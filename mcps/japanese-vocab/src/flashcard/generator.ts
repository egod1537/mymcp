import { formatLocalDate } from "../utils/date.js";
import { ValidationError, generateFlashcardInputSchema } from "../utils/validation.js";
import type { VocabStore } from "../vocab/store.js";
import type { JapaneseWord } from "../vocab/types.js";
import { renderFlashcardHtml } from "./template.js";
import type { FlashcardWord, GenerateFlashcardInput, GenerateFlashcardResult } from "./types.js";

function sanitizeFilename(value: string): string {
  const sanitized = value
    .normalize("NFKC")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return sanitized || "japanese-vocab";
}

function fromStoredWord(word: JapaneseWord): FlashcardWord {
  return {
    id: word.id,
    jp: word.jp,
    rd: word.reading,
    kr: word.meaningKo,
    ...(word.nuance && { nuance: word.nuance }),
  };
}

export function generateFlashcardHtml(
  store: VocabStore,
  rawInput: GenerateFlashcardInput,
): GenerateFlashcardResult {
  const input = generateFlashcardInputSchema.parse(rawInput) as GenerateFlashcardInput;
  let selected: FlashcardWord[];
  if (input.words) {
    selected = input.words.map((word) => ({
      jp: word.jp.trim(), rd: word.rd.trim(), kr: word.kr.trim(),
      ...(word.nuance?.trim() && { nuance: word.nuance.trim() }),
    }));
  } else if (input.wordIds) {
    const stored = store.getWordsByIds(input.wordIds);
    if (stored.length !== input.wordIds.length) {
      throw new ValidationError("One or more requested wordIds were not found.");
    }
    selected = stored.map(fromStoredWord);
  } else {
    selected = store.getWords({
      ...(input.sourceCategory && { sourceCategory: input.sourceCategory }),
      ...(input.sourceSet && { sourceSet: input.sourceSet }),
      limit: 1000,
    }).words.map(fromStoredWord);
  }
  if (selected.length === 0) throw new ValidationError("No vocabulary matched the flashcard selection.");

  const words = selected.map((word, index) => ({ ...word, n: index + 1 }));
  const title = input.title ?? (input.sourceSet
    ? `${input.sourceSet}, 플래시카드`
    : "일본어 어휘 플래시카드");
  const filenameBase = input.sourceSet ?? (input.title ? input.title : `japanese-vocab-${formatLocalDate()}`);
  const html = renderFlashcardHtml(words, title, input.shuffleOnStart ?? true);
  store.logger.debug("flashcard HTML generated", { cardCount: words.length });
  return { filename: `${sanitizeFilename(filenameBase)}.html`, html, cardCount: words.length };
}
