import type {
  JlptBook,
  JlptEntry,
  JlptFolder,
  JlptImportWord,
  JlptRemoteClient,
  JlptStudyCard,
  JlptWordInput,
  JlptWordUpdate,
} from "./types.js";

export class JlptApiError extends Error {
  override readonly name = "JlptApiError";

  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

interface ClientOptions {
  baseUrl: URL;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

interface JlptMutation {
  operationId: string;
  occurredAt: string;
  type: string;
  targetId?: string;
  expectedRevision?: number;
  payload: Record<string, unknown>;
}

interface JlptMutationResult {
  operationId: string;
  status: "applied" | "duplicate" | "conflict" | "rejected";
  error?: { code?: string; message?: string };
  entity?: unknown;
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function importCsv(words: JlptImportWord[]): string {
  return [
    "term,reading,primaryMeaning,nuance",
    ...words.map((word) =>
      [word.term, word.reading, word.primaryMeaning, word.nuance ?? ""].map(csvCell).join(","),
    ),
  ].join("\n");
}

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const error = "error" in body ? body.error : undefined;
  if (error && typeof error === "object" && "message" in error) {
    const message = error.message;
    if (typeof message === "string" && message.trim()) return message.slice(0, 500);
  }
  return fallback;
}

function mutation(
  type: string,
  payload: Record<string, unknown>,
  options: { targetId?: string; expectedRevision?: number } = {},
): JlptMutation {
  return {
    operationId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    type,
    ...options,
    payload,
  };
}

function mutationFailure(results: JlptMutationResult[]): JlptMutationResult | undefined {
  return results.find((result) => result.status !== "applied" && result.status !== "duplicate");
}

function mutationFailureMessage(result: JlptMutationResult): string {
  const detail = result.error?.message?.trim();
  return detail
    ? detail.slice(0, 500)
    : `JLPT mutation ${result.operationId} was ${result.status}.`;
}

export class HttpJlptRemoteClient implements JlptRemoteClient {
  private readonly fetchImpl: typeof fetch;
  private readonly deviceId = `mcp-${crypto.randomUUID()}`;

  constructor(private readonly options: ClientOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  private url(path: string): URL {
    return new URL(path, this.options.baseUrl);
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    write = false,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchImpl(this.url(path), {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(write
            ? {
                Origin: this.options.baseUrl.origin,
                Referer: new URL("/books", this.options.baseUrl).href,
              }
            : {}),
          ...init.headers,
        },
      });
      const body = (await response.json().catch(() => undefined)) as unknown;
      if (!response.ok) {
        throw new JlptApiError(
          response.status === 403 ? "JLPT_API_FORBIDDEN" : "JLPT_API_ERROR",
          errorMessage(body, `JLPT API returned HTTP ${response.status}.`),
          response.status,
          response.status === 429 || response.status >= 500,
        );
      }
      return body as T;
    } catch (error) {
      if (error instanceof JlptApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new JlptApiError("JLPT_API_TIMEOUT", "JLPT API request timed out.", 504, true);
      }
      console.error("JLPT upstream request failed", {
        path: this.url(path).pathname,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message.slice(0, 300) : "Unknown error",
      });
      throw new JlptApiError("JLPT_API_UNAVAILABLE", "JLPT API is unavailable.", 503, true);
    } finally {
      clearTimeout(timeout);
    }
  }

  health(): Promise<{ ok: boolean }> {
    return this.request("/api/healthz");
  }

  listFolders(): Promise<{ folders: JlptFolder[] }> {
    return this.request("/api/folders");
  }

  private getBook(bookId: string): Promise<{ book: JlptBook }> {
    return this.request(`/api/books/${encodeURIComponent(bookId)}`);
  }

  private async getFolder(folderId: string): Promise<JlptFolder> {
    const { folders } = await this.listFolders();
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) {
      throw new JlptApiError(
        "JLPT_FOLDER_NOT_FOUND",
        `JLPT folder ${folderId} was not found.`,
        404,
        false,
      );
    }
    return folder;
  }

  private async getEntry(bookId: string, entryId: string): Promise<JlptEntry> {
    let cursor: number | null = -1;
    while (cursor !== null) {
      const page = await this.getBookEntries({ bookId, cursor, limit: 200 });
      const entry = page.entries.find((item) => item.entryId === entryId);
      if (entry) return entry;
      cursor = page.nextCursor ?? null;
    }
    throw new JlptApiError(
      "JLPT_ENTRY_NOT_FOUND",
      `JLPT entry ${entryId} was not found in book ${bookId}.`,
      404,
      false,
    );
  }

  private async applyMutations(mutations: JlptMutation[]): Promise<JlptMutationResult[]> {
    const response = await this.request<{ results?: JlptMutationResult[] }>(
      "/api/sync/mutations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: this.deviceId,
          mutations,
        }),
      },
      true,
    );
    if (!Array.isArray(response.results) || response.results.length !== mutations.length) {
      throw new JlptApiError(
        "JLPT_MUTATION_INVALID_RESPONSE",
        "JLPT API returned an invalid mutation result.",
        502,
        false,
      );
    }
    return response.results;
  }

  private async applySingleMutation(value: JlptMutation): Promise<void> {
    const results = await this.applyMutations([value]);
    const failure = mutationFailure(results);
    if (failure) {
      throw new JlptApiError(
        `JLPT_MUTATION_${failure.status.toUpperCase()}`,
        mutationFailureMessage(failure),
        409,
        false,
      );
    }
  }

  listBooks(input: { limit: number; offset: number }): Promise<{
    books: JlptBook[];
    nextOffset?: number | null;
  }> {
    const params = new URLSearchParams({
      sort: "custom",
      limit: String(input.limit),
      offset: String(input.offset),
    });
    return this.request(`/api/books?${params}`);
  }

  getBookEntries(input: { bookId: string; cursor: number; limit: number }): Promise<{
    entries: JlptEntry[];
    nextCursor?: number | null;
  }> {
    const params = new URLSearchParams({
      cursor: String(input.cursor),
      limit: String(input.limit),
    });
    return this.request(`/api/books/${encodeURIComponent(input.bookId)}/entries?${params}`);
  }

  search(input: {
    query: string;
    scope: "books" | "words";
    status?: "needs-review";
  }): Promise<{ results: Array<JlptBook | JlptEntry>; scope: string; status?: string }> {
    const params = new URLSearchParams({ query: input.query });
    params.set("q", input.query);
    params.delete("query");
    params.set("scope", input.scope);
    if (input.status) params.set("status", input.status);
    return this.request(`/api/search?${params}`);
  }

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
  }> {
    const params = new URLSearchParams({
      mode: input.mode,
      includeReview: String(input.includeReview),
      limit: String(input.limit),
      seed: String(input.seed),
    });
    if (input.bookIds?.length) params.set("books", input.bookIds.join(","));
    if (input.minStar) params.set("minStar", String(input.minStar));
    if (input.bookmarks) params.set("bookmarks", "true");
    if (input.partOfSpeech) params.set("pos", input.partOfSpeech);
    if (input.chunk) params.set("chunk", String(input.chunk));
    return this.request(`/api/study/cards?${params}`);
  }

  async createFolder(input: {
    name: string;
    parentId?: string;
  }): Promise<{ folderId: string }> {
    const folderId = `folder-${crypto.randomUUID()}`;
    await this.applySingleMutation(
      mutation("folder.create", {
        id: folderId,
        name: input.name,
        parentId: input.parentId ?? null,
        orderIndex: 0,
      }),
    );
    return { folderId };
  }

  async updateFolder(input: {
    folderId: string;
    name?: string;
    parentId?: string | null;
    pinned?: boolean;
  }): Promise<{ folderId: string; updatedFields: string[] }> {
    const folder = await this.getFolder(input.folderId);
    let expectedRevision = Number(folder.revision ?? 0);
    const updatedFields: string[] = [];

    if (input.name !== undefined && input.name !== folder.name) {
      await this.applySingleMutation(
        mutation(
          "folder.rename",
          { name: input.name },
          { targetId: input.folderId, expectedRevision },
        ),
      );
      expectedRevision += 1;
      updatedFields.push("name");
    }
    if (input.parentId !== undefined && input.parentId !== (folder.parentId ?? null)) {
      await this.applySingleMutation(
        mutation(
          "folder.move",
          { parentId: input.parentId, orderIndex: folder.orderIndex ?? 0 },
          { targetId: input.folderId, expectedRevision },
        ),
      );
      expectedRevision += 1;
      updatedFields.push("parentId");
    }
    if (input.pinned !== undefined && input.pinned !== folder.pinned) {
      await this.applySingleMutation(
        mutation(
          "folder.pin",
          { pinned: input.pinned },
          { targetId: input.folderId, expectedRevision },
        ),
      );
      updatedFields.push("pinned");
    }
    return { folderId: input.folderId, updatedFields };
  }

  async deleteFolder(input: {
    folderId: string;
    policy: "unfile-books" | "trash-contents";
  }): Promise<{
    folderId: string;
    policy: "unfile-books" | "trash-contents";
    deleted: true;
  }> {
    const folder = await this.getFolder(input.folderId);
    await this.applySingleMutation(
      mutation(
        "folder.delete",
        { policy: input.policy },
        { targetId: input.folderId, expectedRevision: Number(folder.revision ?? 0) },
      ),
    );
    return { folderId: input.folderId, policy: input.policy, deleted: true };
  }

  async createBook(input: {
    title: string;
    category?: string;
    folderId?: string;
  }): Promise<{ bookId: string }> {
    const bookId = `book-${crypto.randomUUID()}`;
    await this.applySingleMutation(
      mutation("book.create", {
        id: bookId,
        title: input.title,
        category: input.category ?? null,
        folderId: input.folderId ?? null,
        orderIndex: 0,
      }),
    );
    return { bookId };
  }

  async updateBook(input: {
    bookId: string;
    title?: string;
    category?: string | null;
    favorite?: boolean;
    folderId?: string | null;
  }): Promise<{ bookId: string; updatedFields: string[] }> {
    const { book } = await this.getBook(input.bookId);
    let expectedRevision = Number(book.revision ?? 0);
    const updatedFields: string[] = [];
    const metadata: Record<string, unknown> = {};

    if (input.title !== undefined && input.title !== book.title) {
      metadata.title = input.title;
      updatedFields.push("title");
    }
    if (input.category !== undefined && input.category !== (book.category ?? null)) {
      metadata.category = input.category;
      updatedFields.push("category");
    }
    if (input.favorite !== undefined && input.favorite !== book.favorite) {
      metadata.favorite = input.favorite;
      updatedFields.push("favorite");
    }
    if (Object.keys(metadata).length > 0) {
      await this.applySingleMutation(
        mutation("book.update", metadata, { targetId: input.bookId, expectedRevision }),
      );
      expectedRevision += 1;
    }
    if (input.folderId !== undefined && input.folderId !== (book.folderId ?? null)) {
      await this.applySingleMutation(
        mutation(
          "book.move",
          { folderId: input.folderId, orderIndex: book.orderIndex ?? 0 },
          { targetId: input.bookId, expectedRevision },
        ),
      );
      updatedFields.push("folderId");
    }
    return { bookId: input.bookId, updatedFields };
  }

  async deleteBook(input: { bookId: string }): Promise<{ bookId: string; deleted: true }> {
    const { book } = await this.getBook(input.bookId);
    await this.applySingleMutation(
      mutation(
        "book.delete",
        {},
        { targetId: input.bookId, expectedRevision: Number(book.revision ?? 0) },
      ),
    );
    return { bookId: input.bookId, deleted: true };
  }

  async addWords(input: {
    bookId: string;
    words: JlptWordInput[];
  }): Promise<{ bookId: string; insertedEntries: number }> {
    const { book } = await this.getBook(input.bookId);
    const basePosition = Number.isSafeInteger(book.entryCount) ? Number(book.entryCount) : 0;
    const mutations = input.words.map((word, index) => {
      const entryId = `entry-${crypto.randomUUID()}`;
      return mutation("entry.create", {
        entryId,
        bookId: input.bookId,
        position: basePosition + index,
        fields: {
          term: word.term,
          reading: word.reading ?? null,
          meanings: word.meanings?.length ? word.meanings : [word.primaryMeaning],
          primaryMeaning: word.primaryMeaning,
          nuance: word.nuance ?? null,
          partOfSpeech: word.partOfSpeech ?? [],
          jlptLevels: word.jlptLevels ?? [],
          years: word.years ?? [],
          categories: word.categories ?? [],
          relatedTerms: word.relatedTerms ?? [],
          examples: word.examples ?? [],
          sources: [],
          status: word.status ?? "ready",
          tags: word.tags ?? [],
        },
      });
    });

    let insertedEntries = 0;
    for (let offset = 0; offset < mutations.length; offset += 20) {
      const batch = mutations.slice(offset, offset + 20);
      const results = await this.applyMutations(batch);
      insertedEntries += results.filter(
        (result) => result.status === "applied" || result.status === "duplicate",
      ).length;
      const failure = mutationFailure(results);
      if (failure) {
        throw new JlptApiError(
          insertedEntries > 0 ? "JLPT_MUTATION_PARTIAL" : `JLPT_MUTATION_${failure.status.toUpperCase()}`,
          `${mutationFailureMessage(failure)} ${insertedEntries} entries were accepted before the failure.`,
          409,
          false,
        );
      }
    }

    return { bookId: input.bookId, insertedEntries };
  }

  async updateWord(input: {
    bookId: string;
    entryId: string;
    update: JlptWordUpdate;
  }): Promise<{
    bookId: string;
    entryId: string;
    wordId: string;
    updatedFields: string[];
  }> {
    const entry = await this.getEntry(input.bookId, input.entryId);
    const { identityPolicy, ...patch } = input.update;
    const updatedFields = Object.entries(patch)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    const term = patch.term ?? entry.term;
    const reading = patch.reading !== undefined ? patch.reading : (entry.reading ?? null);
    const identityChanged = term !== entry.term || reading !== (entry.reading ?? null);
    const primaryMeaning = patch.primaryMeaning ?? entry.primaryMeaning;
    const fields = {
      term,
      reading,
      meanings: patch.meanings ?? entry.meanings ?? [primaryMeaning],
      primaryMeaning,
      nuance: patch.nuance !== undefined ? patch.nuance : (entry.nuance ?? null),
      partOfSpeech: patch.partOfSpeech ?? entry.partOfSpeech ?? [],
      jlptLevels: patch.jlptLevels ?? entry.jlptLevels ?? [],
      years: patch.years ?? entry.years ?? [],
      categories: patch.categories ?? entry.categories ?? [],
      relatedTerms: patch.relatedTerms ?? entry.relatedTerms ?? [],
      examples: patch.examples ?? entry.examples ?? [],
      sources: entry.sources ?? [],
      status: patch.status ?? entry.status ?? "ready",
      tags: patch.tags ?? entry.tags ?? [],
    };
    await this.applySingleMutation(
      mutation(
        "entry.update",
        { fields, identityPolicy: identityChanged ? identityPolicy : "same" },
        { targetId: input.entryId, expectedRevision: Number(entry.revision ?? 0) },
      ),
    );
    return {
      bookId: input.bookId,
      entryId: input.entryId,
      wordId: entry.wordId,
      updatedFields,
    };
  }

  async deleteWord(input: {
    bookId: string;
    entryId: string;
  }): Promise<{ bookId: string; entryId: string; wordId: string; deleted: true }> {
    const entry = await this.getEntry(input.bookId, input.entryId);
    await this.applySingleMutation(
      mutation(
        "entry.delete",
        {},
        { targetId: input.entryId, expectedRevision: Number(entry.revision ?? 0) },
      ),
    );
    return {
      bookId: input.bookId,
      entryId: input.entryId,
      wordId: entry.wordId,
      deleted: true,
    };
  }

  async moveBooks(input: {
    bookIds: string[];
    folderId: string | null;
  }): Promise<{ bookIds: string[]; folderId: string | null; movedBooks: number }> {
    const books = await Promise.all(input.bookIds.map((bookId) => this.getBook(bookId)));
    const expectedRevisions = Object.fromEntries(
      books.map(({ book }) => [book.id, Number(book.revision ?? 0)]),
    );
    await this.applySingleMutation(
      mutation("books.bulkMove", {
        ids: input.bookIds,
        folderId: input.folderId,
        expectedRevisions,
      }),
    );
    return {
      bookIds: input.bookIds,
      folderId: input.folderId,
      movedBooks: input.bookIds.length,
    };
  }

  async importWords(input: {
    title: string;
    category?: string;
    folderId?: string;
    words: JlptImportWord[];
  }): Promise<{ bookId: string; insertedEntries: number }> {
    const form = new FormData();
    form.append(
      "file",
      new Blob([importCsv(input.words)], { type: "text/csv;charset=utf-8" }),
      "jlpt-mcp-import.csv",
    );
    const preview = await this.request<{
      previewId: string;
      validRows: number;
      invalidRows: number;
      mapping: Record<string, string>;
    }>("/api/imports/preview", { method: "POST", body: form }, true);
    if (
      !preview.previewId ||
      preview.validRows !== input.words.length ||
      preview.invalidRows !== 0
    ) {
      throw new JlptApiError(
        "JLPT_IMPORT_INVALID",
        `JLPT API accepted ${preview.validRows} of ${input.words.length} import rows.`,
        422,
        false,
      );
    }
    return this.request(
      `/api/imports/${encodeURIComponent(preview.previewId)}/commit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: input.title,
          category: input.category ?? null,
          folderId: input.folderId ?? null,
          mapping: preview.mapping,
          validRowsOnly: true,
          duplicatePolicy: "keep-separate",
        }),
      },
      true,
    );
  }
}
