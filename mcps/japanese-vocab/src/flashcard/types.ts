export interface FlashcardWord {
  id?: string;
  n?: number;
  jp: string;
  rd: string;
  kr: string;
  nuance?: string;
}

export interface GenerateFlashcardInput {
  wordIds?: string[];
  sourceCategory?: string;
  sourceSet?: string;
  words?: FlashcardWord[];
  title?: string;
  shuffleOnStart?: boolean;
}

export interface GenerateFlashcardResult {
  filename: string;
  html: string;
  cardCount: number;
}
