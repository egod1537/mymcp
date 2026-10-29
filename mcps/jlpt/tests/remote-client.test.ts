import { describe, expect, it, vi } from "vitest";

import { HttpJlptRemoteClient } from "../src/remote/client.js";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

describe("HttpJlptRemoteClient", () => {
  it("builds bounded read requests for books, entries, search, and cards", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/folders") return json({ folders: [] });
      if (url.pathname === "/api/books") return json({ books: [], nextOffset: null });
      if (url.pathname.endsWith("/entries")) return json({ entries: [], nextCursor: null });
      if (url.pathname === "/api/search") return json({ results: [], scope: "words" });
      if (url.pathname === "/api/study/cards") {
        return json({ cards: [], totalMatches: 0, dueCount: 0 });
      }
      throw new Error(`unexpected path ${url.pathname}`);
    });
    const client = new HttpJlptRemoteClient({
      baseUrl: new URL("https://jlpt.mangagaki.net"),
      timeoutMs: 1_000,
      fetchImpl,
    });

    await client.listFolders();
    await client.listBooks({ limit: 10, offset: 20 });
    await client.getBookEntries({ bookId: "book-1", cursor: -1, limit: 50 });
    await client.search({ query: "確認", scope: "words", status: "needs-review" });
    await client.getStudyCards({
      mode: "unseen",
      includeReview: false,
      limit: 14,
      seed: 7,
      bookIds: ["book-1"],
    });

    const urls = fetchImpl.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls[0]?.pathname).toBe("/api/folders");
    expect(urls[1]?.searchParams.get("limit")).toBe("10");
    expect(urls[1]?.searchParams.get("offset")).toBe("20");
    expect(urls[2]?.pathname).toBe("/api/books/book-1/entries");
    expect(urls[3]?.searchParams.get("q")).toBe("確認");
    expect(urls[3]?.searchParams.get("status")).toBe("needs-review");
    expect(urls[4]?.searchParams.get("books")).toBe("book-1");
  });

  it("creates folders and books, adds words, and moves books through sync mutations", async () => {
    const mutationBodies: Array<{
      deviceId: string;
      mutations: Array<{
        operationId: string;
        type: string;
        payload: Record<string, unknown>;
      }>;
    }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/books/book-existing") {
        return json({
          book: {
            id: "book-existing",
            title: "기존 단어장",
            revision: 4,
            entryCount: 2,
          },
        });
      }
      if (url.pathname === "/api/sync/mutations") {
        const body = JSON.parse(String(init?.body)) as (typeof mutationBodies)[number];
        mutationBodies.push(body);
        return json({
          results: body.mutations.map((item) => ({
            operationId: item.operationId,
            status: "applied",
          })),
        });
      }
      throw new Error(`unexpected path ${url.pathname}`);
    });
    const client = new HttpJlptRemoteClient({
      baseUrl: new URL("https://jlpt.mangagaki.net"),
      timeoutMs: 1_000,
      fetchImpl,
    });

    const folder = await client.createFolder({ name: "N1" });
    const book = await client.createBook({
      title: "새 단어장",
      category: "문법",
      folderId: folder.folderId,
    });
    await expect(
      client.addWords({
        bookId: "book-existing",
        words: [{ term: "確認", reading: "かくにん", primaryMeaning: "확인" }],
      }),
    ).resolves.toEqual({ bookId: "book-existing", insertedEntries: 1 });
    await expect(
      client.moveBooks({ bookIds: ["book-existing"], folderId: folder.folderId }),
    ).resolves.toMatchObject({ movedBooks: 1, folderId: folder.folderId });

    expect(book.bookId).toMatch(/^book-/);
    expect(mutationBodies.map((body) => body.mutations[0]?.type)).toEqual([
      "folder.create",
      "book.create",
      "entry.create",
      "books.bulkMove",
    ]);
    expect(mutationBodies[1]?.mutations[0]?.payload).toMatchObject({
      id: book.bookId,
      folderId: folder.folderId,
    });
    expect(mutationBodies[2]?.mutations[0]?.payload).toMatchObject({
      bookId: "book-existing",
      position: 2,
      fields: {
        term: "確認",
        reading: "かくにん",
        primaryMeaning: "확인",
        status: "ready",
      },
    });
    expect(mutationBodies[3]?.mutations[0]?.payload).toMatchObject({
      ids: ["book-existing"],
      folderId: folder.folderId,
      expectedRevisions: { "book-existing": 4 },
    });
    for (const call of fetchImpl.mock.calls.filter(([input]) =>
      new URL(String(input)).pathname.includes("/api/sync/mutations"))) {
      const headers = new Headers(call[1]?.headers);
      expect(headers.get("origin")).toBe("https://jlpt.mangagaki.net");
      expect(headers.get("referer")).toBe("https://jlpt.mangagaki.net/books");
    }
  });

  it("previews and commits imports with same-origin write headers", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          previewId: "preview-1",
          validRows: 1,
          invalidRows: 0,
          mapping: {
            term: "term",
            reading: "reading",
            primaryMeaning: "primaryMeaning",
            nuance: "nuance",
          },
        }),
      )
      .mockResolvedValueOnce(json({ bookId: "book-1", insertedEntries: 1 }));
    const client = new HttpJlptRemoteClient({
      baseUrl: new URL("https://jlpt.mangagaki.net"),
      timeoutMs: 1_000,
      fetchImpl,
    });

    await expect(
      client.importWords({
        title: "테스트",
        words: [
          { term: "確認", reading: "かくにん", primaryMeaning: "확인", nuance: "검증" },
        ],
      }),
    ).resolves.toEqual({ bookId: "book-1", insertedEntries: 1 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchImpl.mock.calls) {
      const headers = new Headers(init?.headers);
      expect(headers.get("origin")).toBe("https://jlpt.mangagaki.net");
      expect(headers.get("referer")).toBe("https://jlpt.mangagaki.net/books");
    }
    const commitInit = fetchImpl.mock.calls[1]?.[1];
    expect(JSON.parse(String(commitInit?.body))).toMatchObject({
      title: "테스트",
      validRowsOnly: true,
      duplicatePolicy: "keep-separate",
    });
  });

  it("maps upstream write protection to a stable error", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({ error: { code: "FORBIDDEN", message: "요청을 확인할 수 없습니다." } }, 403),
    );
    const client = new HttpJlptRemoteClient({
      baseUrl: new URL("https://jlpt.mangagaki.net"),
      timeoutMs: 1_000,
      fetchImpl,
    });

    await expect(client.health()).rejects.toMatchObject({
      code: "JLPT_API_FORBIDDEN",
      status: 403,
      retryable: false,
    });
  });
});
