import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { generateFlashcardHtml } from "../src/flashcard/generator.js";
import { serializeForInlineScript } from "../src/flashcard/html-escape.js";
import { VocabStore } from "../src/vocab/store.js";

const stores: VocabStore[] = [];
function store(): VocabStore {
  const instance = new VocabStore({ dbPath: ":memory:" });
  stores.push(instance);
  return instance;
}
afterEach(() => { while (stores.length) stores.pop()?.close(); });

const requiredIds = [
  "headerCounter", "timerBar", "btnStar", "btnInfinite", "optRemaining", "btnSpeak",
  "mainArea", "kanjiDisplay", "nuanceContext", "hintKr", "hintRd", "doneScreen",
  "progressFill", "progressLabel", "bottomArea", "btnKr", "btnRd", "btnStudy",
  "btnKnow", "btnRetry", "btnRestart",
];

function oneCardHtml(): string {
  return generateFlashcardHtml(store(), {
    words: [{ jp: "訴える", rd: "うったえる", kr: "호소하다", nuance: "요구·주장" }],
    shuffleOnStart: false,
  }).html;
}

describe("flashcard HTML", () => {
  it("contains every required ID, style rule, and standalone interaction", () => {
    const result = generateFlashcardHtml(store(), {
      words: [{ jp: "素朴な", rd: "そぼくな", kr: "소박한" }],
      title: "테스트 단어장",
    });
    expect(result).toMatchObject({ cardCount: 1, filename: "테스트-단어장.html" });
    for (const id of requiredIds) expect(result.html).toContain(`id="${id}"`);
    expect(result.html).toContain("function shuffle(arr)");
    expect(result.html).toContain("hideHints();\n      const w = deck[idx]");
    expect(result.html).toContain("Noto+Sans+JP");
    expect(result.html).toContain("background:#0f1218 !important");
    expect(result.html).not.toContain("eval(");
  });

  it("escapes inline script termination and HTML-sensitive characters", () => {
    const dangerous = "</script><img src=x onerror=alert(1)>`'&";
    const serialized = serializeForInlineScript([{ jp: dangerous }]);
    expect(serialized).not.toContain("</script>");
    expect(serialized).not.toContain("<img");
    const html = generateFlashcardHtml(store(), {
      words: [{ jp: dangerous, rd: "よみ", kr: dangerous }],
    }).html;
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("\\u003c/script\\u003e");
  });

  it("toggles hints, hides them before a left swipe, and offers unknown-only retry", async () => {
    const dom = new JSDOM(oneCardHtml(), { runScripts: "dangerously", pretendToBeVisual: true });
    const document = dom.window.document;
    expect(document.getElementById("hintKr")!.classList.contains("visible")).toBe(false);
    expect(document.getElementById("hintRd")!.classList.contains("visible")).toBe(false);
    document.getElementById("btnKr")!.click();
    expect(document.getElementById("hintKr")!.classList.contains("visible")).toBe(true);
    expect(document.getElementById("hintRd")!.classList.contains("visible")).toBe(false);

    document.getElementById("btnStudy")!.click();
    expect(document.getElementById("hintKr")!.classList.contains("visible")).toBe(false);
    expect(document.getElementById("mainArea")!.classList.contains("swipe-left")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 240));
    expect(document.getElementById("doneScreen")!.style.display).toBe("flex");
    expect(document.getElementById("btnRetry")!.style.display).toBe("block");
    expect(document.getElementById("btnRetry")!.textContent).toContain("1장");
    document.getElementById("btnRetry")!.click();
    expect(document.getElementById("mainArea")!.style.display).toBe("flex");
    dom.window.close();
  });

  it("uses a right swipe for known cards and hides retry when none are unknown", async () => {
    const dom = new JSDOM(oneCardHtml(), { runScripts: "dangerously", pretendToBeVisual: true });
    const document = dom.window.document;
    document.getElementById("btnRd")!.click();
    expect(document.getElementById("hintRd")!.classList.contains("visible")).toBe(true);
    document.getElementById("btnKnow")!.click();
    expect(document.getElementById("hintRd")!.classList.contains("visible")).toBe(false);
    expect(document.getElementById("mainArea")!.classList.contains("swipe-right")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 240));
    expect(document.getElementById("btnRetry")!.style.display).toBe("none");
    expect(document.getElementById("btnRestart")!.classList.contains("btn-restart-secondary")).toBe(true);
    dom.window.close();
  });

  it("retries only studyList while restart restores the full word list", async () => {
    const html = generateFlashcardHtml(store(), {
      words: [
        { jp: "一", rd: "いち", kr: "하나" },
        { jp: "二", rd: "に", kr: "둘" },
      ],
      shuffleOnStart: false,
    }).html;
    const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
    const document = dom.window.document;
    document.getElementById("btnStudy")!.click();
    await new Promise((resolve) => setTimeout(resolve, 240));
    document.getElementById("btnKnow")!.click();
    await new Promise((resolve) => setTimeout(resolve, 240));
    document.getElementById("btnRetry")!.click();
    expect(document.getElementById("headerCounter")!.textContent).toBe("1 / 1");
    document.getElementById("btnStudy")!.click();
    await new Promise((resolve) => setTimeout(resolve, 240));
    document.getElementById("btnRestart")!.click();
    expect(document.getElementById("headerCounter")!.textContent).toBe("1 / 2");
    dom.window.close();
  });
});
