import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import type { JlptRemoteClient } from "../src/remote/types.js";
import { createJlptWorkerServer, loadJlptRemoteConfig, type JlptWorkerEnv } from "../src/worker.js";

function remoteClient(): JlptRemoteClient {
  return {
    health: vi.fn().mockResolvedValue({ ok: true }),
    listFolders: vi.fn().mockResolvedValue({
      folders: [{ id: "folder-1", name: "N1", parentId: null, bookCount: 1 }],
    }),
    listBooks: vi.fn().mockResolvedValue({
      books: [{ id: "book-1", title: "기출 단어", entryCount: 1 }],
      nextOffset: null,
    }),
    getBookEntries: vi.fn().mockResolvedValue({
      entries: [
        {
          entryId: "entry-1",
          wordId: "word-1",
          bookId: "book-1",
          term: "確認",
          reading: "かくにん",
          primaryMeaning: "확인",
        },
      ],
      nextCursor: null,
    }),
    search: vi.fn().mockResolvedValue({
      results: [
        {
          entryId: "entry-1",
          wordId: "word-1",
          bookId: "book-1",
          term: "確認",
          reading: "かくにん",
          primaryMeaning: "확인",
        },
      ],
      scope: "words",
    }),
    getStudyCards: vi.fn().mockResolvedValue({
      cards: [
        {
          wordId: "word-1",
          representative: {
            entryId: "entry-1",
            wordId: "word-1",
            bookId: "book-1",
            term: "確認",
            reading: "かくにん",
            primaryMeaning: "확인",
          },
          occurrences: [],
        },
      ],
      totalMatches: 1,
      dueCount: 0,
    }),
    createFolder: vi.fn().mockResolvedValue({ folderId: "folder-2" }),
    updateFolder: vi.fn().mockResolvedValue({
      folderId: "folder-2",
      updatedFields: ["name", "pinned"],
    }),
    deleteFolder: vi.fn().mockResolvedValue({
      folderId: "folder-2",
      policy: "unfile-books",
      deleted: true,
    }),
    createBook: vi.fn().mockResolvedValue({ bookId: "book-2" }),
    updateBook: vi.fn().mockResolvedValue({
      bookId: "book-2",
      updatedFields: ["title", "favorite"],
    }),
    deleteBook: vi.fn().mockResolvedValue({ bookId: "book-2", deleted: true }),
    addWords: vi.fn().mockResolvedValue({ bookId: "book-2", insertedEntries: 1 }),
    updateWord: vi.fn().mockResolvedValue({
      bookId: "book-2",
      entryId: "entry-2",
      wordId: "word-2",
      updatedFields: ["primaryMeaning"],
    }),
    deleteWord: vi.fn().mockResolvedValue({
      bookId: "book-2",
      entryId: "entry-2",
      wordId: "word-2",
      deleted: true,
    }),
    moveBooks: vi.fn().mockResolvedValue({
      bookIds: ["book-2"],
      folderId: "folder-2",
      movedBooks: 1,
    }),
    importWords: vi.fn().mockResolvedValue({ bookId: "book-2", insertedEntries: 1 }),
  };
}

function env(overrides: Partial<JlptWorkerEnv> = {}): JlptWorkerEnv {
  return {
    JLPT_API_BASE_URL: "https://jlpt.mangagaki.net",
    JLPT_ENABLE_WRITES: "true",
    MCP_RATE_LIMITER: { limit: async () => ({ success: true }) },
    JLPT_WRITE_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ...overrides,
  };
}

describe("JLPT remote Worker", () => {
  it("rejects arbitrary API origins", () => {
    expect(() =>
      loadJlptRemoteConfig(env({ JLPT_API_BASE_URL: "https://attacker.example" })),
    ).toThrow("JLPT_API_BASE_URL");
  });

  it("exposes folder, book, and word-management tools and calls the injected client", async () => {
    const clientImplementation = remoteClient();
    const server = createJlptWorkerServer(env(), clientImplementation);
    const client = new Client({ name: "jlpt-worker-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map(({ name }) => name)).toEqual([
        "jlpt_list_books",
        "jlpt_list_folders",
        "jlpt_get_book_entries",
        "jlpt_search",
        "jlpt_get_study_cards",
        "jlpt_create_folder",
        "jlpt_update_folder",
        "jlpt_delete_folder",
        "jlpt_create_book",
        "jlpt_update_book",
        "jlpt_delete_book",
        "jlpt_add_words",
        "jlpt_update_word",
        "jlpt_delete_word",
        "jlpt_move_books",
        "jlpt_import_words",
      ]);
      for (const name of ["jlpt_delete_folder", "jlpt_delete_book", "jlpt_delete_word"]) {
        expect(tools.tools.find((tool) => tool.name === name)?.annotations).toMatchObject({
          readOnlyHint: false,
          destructiveHint: true,
        });
      }

      const listed = await client.callTool({ name: "jlpt_list_books", arguments: {} });
      expect(listed.structuredContent).toMatchObject({
        source: "jlpt_api",
        count: 1,
        books: [{ id: "book-1", title: "기출 단어" }],
      });

      const searched = await client.callTool({
        name: "jlpt_search",
        arguments: { query: "確認" },
      });
      expect(searched.structuredContent).toMatchObject({ count: 1, scope: "words" });

      const folders = await client.callTool({ name: "jlpt_list_folders", arguments: {} });
      expect(folders.structuredContent).toMatchObject({
        count: 1,
        folders: [{ id: "folder-1", name: "N1", parentId: null }],
      });

      const createdFolder = await client.callTool({
        name: "jlpt_create_folder",
        arguments: { name: "새 폴더", confirm: true },
      });
      expect(createdFolder.structuredContent).toMatchObject({
        status: "created",
        folderId: "folder-2",
      });

      const updatedFolder = await client.callTool({
        name: "jlpt_update_folder",
        arguments: { folderId: "folder-2", name: "수정 폴더", pinned: true, confirm: true },
      });
      expect(updatedFolder.structuredContent).toMatchObject({
        status: "updated",
        updatedFields: ["name", "pinned"],
      });

      const deletedFolder = await client.callTool({
        name: "jlpt_delete_folder",
        arguments: { folderId: "folder-2", confirm: true },
      });
      expect(deletedFolder.structuredContent).toMatchObject({
        status: "deleted",
        policy: "unfile-books",
        deleted: true,
      });

      const createdBook = await client.callTool({
        name: "jlpt_create_book",
        arguments: { title: "새 단어장", folderId: "folder-2", confirm: true },
      });
      expect(createdBook.structuredContent).toMatchObject({
        status: "created",
        bookId: "book-2",
      });

      const updatedBook = await client.callTool({
        name: "jlpt_update_book",
        arguments: { bookId: "book-2", title: "수정 단어장", favorite: true, confirm: true },
      });
      expect(updatedBook.structuredContent).toMatchObject({
        status: "updated",
        updatedFields: ["title", "favorite"],
      });

      const deletedBook = await client.callTool({
        name: "jlpt_delete_book",
        arguments: { bookId: "book-2", confirm: true },
      });
      expect(deletedBook.structuredContent).toMatchObject({ status: "deleted", deleted: true });

      const added = await client.callTool({
        name: "jlpt_add_words",
        arguments: {
          bookId: "book-2",
          words: [{ term: "確認", reading: "かくにん", primaryMeaning: "확인" }],
          confirm: true,
        },
      });
      expect(added.structuredContent).toMatchObject({
        status: "added",
        bookId: "book-2",
        insertedEntries: 1,
      });

      const updatedWord = await client.callTool({
        name: "jlpt_update_word",
        arguments: {
          bookId: "book-2",
          entryId: "entry-2",
          primaryMeaning: "확인하기",
          confirm: true,
        },
      });
      expect(updatedWord.structuredContent).toMatchObject({
        status: "updated",
        entryId: "entry-2",
        updatedFields: ["primaryMeaning"],
      });

      const deletedWord = await client.callTool({
        name: "jlpt_delete_word",
        arguments: { bookId: "book-2", entryId: "entry-2", confirm: true },
      });
      expect(deletedWord.structuredContent).toMatchObject({
        status: "deleted",
        entryId: "entry-2",
        deleted: true,
      });

      const moved = await client.callTool({
        name: "jlpt_move_books",
        arguments: { bookIds: ["book-2"], folderId: "folder-2", confirm: true },
      });
      expect(moved.structuredContent).toMatchObject({ status: "moved", movedBooks: 1 });

      const imported = await client.callTool({
        name: "jlpt_import_words",
        arguments: {
          title: "테스트",
          confirm: true,
          words: [{ term: "確認", reading: "かくにん", primaryMeaning: "확인" }],
        },
      });
      expect(imported.structuredContent).toMatchObject({
        status: "imported",
        bookId: "book-2",
        insertedEntries: 1,
      });
      expect(clientImplementation.importWords).toHaveBeenCalledTimes(1);
      expect(clientImplementation.createFolder).toHaveBeenCalledTimes(1);
      expect(clientImplementation.updateFolder).toHaveBeenCalledTimes(1);
      expect(clientImplementation.deleteFolder).toHaveBeenCalledTimes(1);
      expect(clientImplementation.createBook).toHaveBeenCalledTimes(1);
      expect(clientImplementation.updateBook).toHaveBeenCalledTimes(1);
      expect(clientImplementation.deleteBook).toHaveBeenCalledTimes(1);
      expect(clientImplementation.addWords).toHaveBeenCalledTimes(1);
      expect(clientImplementation.updateWord).toHaveBeenCalledTimes(1);
      expect(clientImplementation.deleteWord).toHaveBeenCalledTimes(1);
      expect(clientImplementation.moveBooks).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("does not advertise write tools when deployment writes are disabled", async () => {
    const clientImplementation = remoteClient();
    const server = createJlptWorkerServer(
      env({ JLPT_ENABLE_WRITES: "false" }),
      clientImplementation,
    );
    const client = new Client({ name: "jlpt-worker-read-only-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map(({ name }) => name)).toEqual([
        "jlpt_list_books",
        "jlpt_list_folders",
        "jlpt_get_book_entries",
        "jlpt_search",
        "jlpt_get_study_cards",
      ]);
      expect(clientImplementation.importWords).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });
});
