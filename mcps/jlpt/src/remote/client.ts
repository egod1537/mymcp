import type {
  JlptBook,
  JlptEntry,
  JlptFolder,
  JlptImportWord,
  JlptRemoteClient,
  JlptStudyCard,
  JlptWordInput,
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
