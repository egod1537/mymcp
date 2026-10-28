import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseWordList } from "../src/vocab/parser.js";

const fixture = readFileSync(fileURLToPath(new URL("fixtures/word-list.txt", import.meta.url)), "utf8");

describe("word-list parser", () => {
  it("parses spaced text and embedded nuances", () => {
    const result = parseWordList(fixture);
    expect(result.errors).toEqual([]);
    expect(result.words).toHaveLength(4);
    expect(result.words[1]).toEqual({
      jp: "訴える",
      reading: "うったえる",
      meaningKo: "호소하다, 주장하다",
      nuance: "요구·주장",
      sourceIndex: 2,
    });
  });

  it("parses TSV, CSV with quoted commas, Markdown, and JSON", () => {
    expect(parseWordList("遂行\tすいこう\t수행").words[0]?.jp).toBe("遂行");
    expect(parseWordList('促進,そくしん,"촉진, 장려"').words[0]?.meaningKo).toBe("촉진, 장려");
    expect(parseWordList("jp,reading,meaningKo,nuance\n訴える,うったえる,고소하다,법적 대응").words[0]).toMatchObject({
      meaningKo: "고소하다", nuance: "법적 대응",
    });
    expect(parseWordList(`| jp | reading | meaningKo | nuance |
| --- | --- | --- | --- |
| 訴える | うったえる | 고소하다 | 법적 대응 |`).words[0]).toMatchObject({
      jp: "訴える", nuance: "법적 대응", meaningKo: "고소하다",
    });
    expect(parseWordList(JSON.stringify([{ jp: "素朴な", rd: "そぼくな", kr: "소박한" }])).words[0]).toMatchObject({
      jp: "素朴な", reading: "そぼくな", meaningKo: "소박한",
    });
  });

  it("reports malformed rows instead of silently discarding them", () => {
    const result = parseWordList("valid\tよみ\t뜻\nbroken row");
    expect(result.words).toHaveLength(1);
    expect(result.errors).toEqual([
      expect.objectContaining({ line: 2, text: "broken row" }),
    ]);
  });
});
