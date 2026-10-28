import { afterEach, describe, expect, it } from "vitest";
import { importWordList } from "../src/vocab/importer.js";
import { VocabStore } from "../src/vocab/store.js";

const stores: VocabStore[] = [];
const fixedNow = new Date("2026-10-06T03:00:00.000Z");

function createStore(random = () => 0.25): VocabStore {
  const store = new VocabStore({ dbPath: ":memory:", now: () => fixedNow, random });
  stores.push(store);
  return store;
}

function makeWords(count: number, prefix = "단어"): string {
  return Array.from({ length: count }, (_, index) =>
    `${prefix}${String(index + 1).padStart(2, "0")}\tよみ${index + 1}\t뜻${index + 1}`,
  ).join("\n");
}

afterEach(() => {
  while (stores.length) stores.pop()?.close();
});

describe("imports and duplicates", () => {
  it("skips exact duplicates, preserves different nuances, and reports meaning conflicts", () => {
    const store = createStore();
    const first = importWordList(store, {
      text: "訴える｜요구·주장\tうったえる\t호소하다",
      sourceCategory: "언지",
      sourceSet: "2026-10 2주차 언지 단어장",
    });
    expect(first.imported).toBe(1);

    const duplicate = importWordList(store, {
      text: "訴える｜요구·주장\tうったえる\t호소하다",
      sourceSet: "다른 단어장",
      duplicatePolicy: "report",
    });
    expect(duplicate).toMatchObject({ imported: 0, skippedDuplicates: 1, conflicts: 0 });
    expect(duplicate.duplicateWords).toHaveLength(1);

    const conflict = importWordList(store, {
      text: "訴える｜요구·주장\tうったえる\t소송을 제기하다",
      sourceSet: "다른 단어장",
    });
    expect(conflict).toMatchObject({ imported: 0, skippedDuplicates: 0, conflicts: 1 });
    expect(conflict.conflictWords?.[0]?.existing[0]?.meaningKo).toBe("호소하다");

    const separateSense = importWordList(store, {
      text: "訴える｜법적 대응\tうったえる\t고소하다",
      sourceSet: "다른 단어장",
    });
    expect(separateSense.imported).toBe(1);
    expect(store.getWords().total).toBe(2);
  });
});

describe("daily distribution", () => {
  it("distributes 14 oldest words and reuses the same-day batch", () => {
    const store = createStore();
    importWordList(store, { text: makeWords(20), sourceCategory: "언지", sourceSet: "A" });
    const first = store.getDailyWords({});
    const repeated = store.getDailyWords({});

    expect(first).toMatchObject({ requestedCount: 14, returnedCount: 14, remainingUnseen: 6, reusedBatch: false });
    expect(repeated).toMatchObject({ batchId: first.batchId, returnedCount: 14, remainingUnseen: 6, reusedBatch: true });
    expect(repeated.words.map((word) => word.id)).toEqual(first.words.map((word) => word.id));
  });

  it("creates a different batch only when forced", () => {
    const store = createStore();
    importWordList(store, { text: makeWords(20), sourceSet: "A" });
    const first = store.getDailyWords({ count: 14 });
    const next = store.getDailyWords({ count: 14, forceNewBatch: true });
    expect(next.batchId).not.toBe(first.batchId);
    expect(next.returnedCount).toBe(6);
    expect(next.remainingUnseen).toBe(0);
  });

  it("applies source filters and exclusions", () => {
    const store = createStore();
    importWordList(store, { text: makeWords(3, "언지"), sourceCategory: "언지", sourceSet: "언지 A" });
    importWordList(store, { text: makeWords(3, "독해"), sourceCategory: "독해", sourceSet: "독해 A" });
    const result = store.getDailyWords({ count: 2, sourceCategory: "언지", excludeSourceSets: ["제외"] });
    expect(result.words).toHaveLength(2);
    expect(result.words.every((word) => word.sourceCategory === "언지")).toBe(true);
  });

  it("records history and reset state without stale batch reuse", () => {
    const store = createStore();
    importWordList(store, { text: makeWords(3), sourceCategory: "언지", sourceSet: "A" });
    const daily = store.getDailyWords({ count: 3 });
    expect(store.getDistributionHistory()).toEqual([
      expect.objectContaining({ date: "2026-10-06", words: expect.arrayContaining(daily.words) }),
    ]);
    expect(store.resetDistribution({ wordIds: [daily.words[0]!.id] })).toBe(1);
    const next = store.getDailyWords({ count: 3 });
    expect(next.reusedBatch).toBe(false);
    expect(next.words).toHaveLength(1);
  });
});

describe("queries", () => {
  it("filters, pages, and searches selected fields", () => {
    const store = createStore();
    importWordList(store, {
      text: "遂行\tすいこう\t수행하다\n促進\tそくしん\t촉진하다",
      sourceCategory: "독해",
      sourceSet: "기출 단어",
    });
    expect(store.getWords({ sourceSet: "기출 단어", limit: 1 })).toMatchObject({ total: 2, words: [expect.any(Object)] });
    expect(store.searchWords({ query: "수행", fields: ["meaningKo"] }).map((word) => word.jp)).toEqual(["遂行"]);
    expect(store.searchWords({ query: "수행", fields: ["reading"] })).toEqual([]);
  });
});
