export interface JlptFolder {
  id: string;
  name: string;
  parentId?: string | null;
  pinned?: boolean;
  orderIndex?: number;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
  bookCount?: number;
  childCount?: number;
}

export interface JlptBook {
  id: string;
  title: string;
  category?: string | null;
  folderId?: string | null;
  entryCount?: number;
  studiedCount?: number;
  favorite?: boolean;
  orderIndex?: number;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface JlptEntry {
  entryId: string;
  wordId: string;
  bookId: string;
  term: string;
  reading?: string | null;
  primaryMeaning: string;
  meanings?: string[];
  nuance?: string | null;
  partOfSpeech?: string[];
  jlptLevels?: string[];
  categories?: string[];
  tags?: string[];
  years?: number[];
  examples?: Array<{ ja: string; ko?: string | null }>;
  relatedTerms?: string[];
  sources?: unknown[];
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  bookTitle?: string;
  position?: number;
  revision?: number;
}

export interface JlptStudyCard {
  wordId: string;
  representative: JlptEntry;
  occurrences?: JlptEntry[];
  review?: {
    dueAt?: string | null;
    lastReviewedAt?: string | null;
    lastRating?: string | null;
  };
}

export interface JlptImportWord {
  term: string;
  reading: string;
  primaryMeaning: string;
  nuance?: string;
}

export interface JlptWordInput {
  term: string;
  reading?: string;
  primaryMeaning: string;
  meanings?: string[];
  nuance?: string;
  partOfSpeech?: string[];
  jlptLevels?: string[];
  years?: number[];
  categories?: string[];
  relatedTerms?: string[];
  examples?: Array<{ ja: string; ko?: string }>;
  tags?: string[];
  status?: "ready" | "needs-review";
}

export interface JlptWordUpdate {
  term?: string;
  reading?: string | null;
  primaryMeaning?: string;
  meanings?: string[];
  nuance?: string | null;
  partOfSpeech?: string[];
  jlptLevels?: string[];
  years?: number[];
  categories?: string[];
  relatedTerms?: string[];
  examples?: Array<{ ja: string; ko?: string | null }>;
  tags?: string[];
  status?: "ready" | "needs-review";
  identityPolicy: "fork" | "same";
}

export interface JlptRemoteClient {
  health(): Promise<{ ok: boolean }>;
  listFolders(): Promise<{ folders: JlptFolder[] }>;
  listBooks(input: { limit: number; offset: number }): Promise<{
    books: JlptBook[];
    nextOffset?: number | null;
  }>;
  getBookEntries(input: { bookId: string; cursor: number; limit: number }): Promise<{
    entries: JlptEntry[];
    nextCursor?: number | null;
  }>;
  search(input: {
    query: string;
    scope: "books" | "words";
    status?: "needs-review";
  }): Promise<{ results: Array<JlptBook | JlptEntry>; scope: string; status?: string }>;
  getStudyCards(input: {
    mode: "unseen" | "due" | "weak";
    includeReview: boolean;
    limit: number;
    seed: number;
    bookIds?: string[];
    minStar?: number;
    bookmarks?: boolean;
    partOfSpeech?: string;
    chunk?: number;
  }): Promise<{
    cards: JlptStudyCard[];
    dueCount?: number;
    totalMatches?: number;
    serverTime?: string;
  }>;
  importWords(input: {
    title: string;
    category?: string;
    folderId?: string;
    words: JlptImportWord[];
  }): Promise<{ bookId: string; insertedEntries: number }>;
  createFolder(input: { name: string; parentId?: string }): Promise<{ folderId: string }>;
  createBook(input: {
    title: string;
    category?: string;
    folderId?: string;
  }): Promise<{ bookId: string }>;
  addWords(input: {
    bookId: string;
    words: JlptWordInput[];
  }): Promise<{ bookId: string; insertedEntries: number }>;
  moveBooks(input: {
    bookIds: string[];
    folderId: string | null;
  }): Promise<{ bookIds: string[]; folderId: string | null; movedBooks: number }>;
  updateFolder(input: {
    folderId: string;
    name?: string;
    parentId?: string | null;
    pinned?: boolean;
  }): Promise<{ folderId: string; updatedFields: string[] }>;
  updateBook(input: {
    bookId: string;
    title?: string;
    category?: string | null;
    favorite?: boolean;
    folderId?: string | null;
  }): Promise<{ bookId: string; updatedFields: string[] }>;
  updateWord(input: {
    bookId: string;
    entryId: string;
    update: JlptWordUpdate;
  }): Promise<{
    bookId: string;
    entryId: string;
    wordId: string;
    updatedFields: string[];
  }>;
  deleteFolder(input: {
    folderId: string;
    policy: "unfile-books" | "trash-contents";
  }): Promise<{
    folderId: string;
    policy: "unfile-books" | "trash-contents";
    deleted: true;
  }>;
  deleteBook(input: { bookId: string }): Promise<{ bookId: string; deleted: true }>;
  deleteWord(input: {
    bookId: string;
    entryId: string;
  }): Promise<{ bookId: string; entryId: string; wordId: string; deleted: true }>;
}
