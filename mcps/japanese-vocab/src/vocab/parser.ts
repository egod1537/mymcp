import { cleanField, normalizeParsedWord, splitJapaneseAndNuance } from "./normalize.js";
import type { ParsedWord, ParsedWordList } from "./types.js";

type UnknownRecord = Record<string, unknown>;

const JP_HEADERS = new Set(["jp", "japanese", "단어", "일본어", "표기"]);
const READING_HEADERS = new Set(["reading", "rd", "읽기", "요미가나", "히라가나"]);
const MEANING_HEADERS = new Set(["meaningko", "meaning", "kr", "뜻", "의미", "한국어"]);
const NUANCE_HEADERS = new Set(["nuance", "뉘앙스", "문맥"]);

function normalizedHeader(value: string): string {
  return value.trim().toLocaleLowerCase().replaceAll(/[_\s-]/g, "");
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function looksLikeHeader(cells: string[]): boolean {
  const keys = cells.map(normalizedHeader);
  return keys.some((key) => JP_HEADERS.has(key)) &&
    keys.some((key) => READING_HEADERS.has(key)) &&
    keys.some((key) => MEANING_HEADERS.has(key));
}

function fromFields(fields: string[], sourceIndex: number): ParsedWord | undefined {
  if (fields.length < 3) return undefined;
  const { jp, nuance: embeddedNuance } = splitJapaneseAndNuance(fields[0] ?? "");
  const reading = cleanField(fields[1] ?? "");
  const meaningKo = cleanField(fields.slice(2).join(fields.length > 3 ? ", " : ""));
  if (!jp || !reading || !meaningKo) return undefined;
  return normalizeParsedWord({ jp, reading, meaningKo, ...(embeddedNuance && { nuance: embeddedNuance }), sourceIndex });
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function splitDelimitedLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map(cleanField);
  if (/\s{2,}/.test(line)) return line.split(/\s{2,}/).map(cleanField);
  if (line.includes(",")) return parseCsvLine(line).map(cleanField);
  return [];
}

function recordString(record: UnknownRecord, names: string[]): string | undefined {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function recordNumber(record: UnknownRecord, names: string[]): number | undefined {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  }
  return undefined;
}

function parseJson(text: string): ParsedWordList {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      words: [],
      errors: [{ line: 1, text: text.slice(0, 200), message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }

  const candidate = value !== null && typeof value === "object" && !Array.isArray(value) &&
    Array.isArray((value as UnknownRecord).words)
    ? (value as UnknownRecord).words
    : value;
  const records = Array.isArray(candidate) ? candidate : [candidate];
  const words: ParsedWord[] = [];
  const errors: ParsedWordList["errors"] = [];

  records.forEach((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push({ line: index + 1, text: JSON.stringify(entry), message: "JSON word must be an object." });
      return;
    }
    const record = entry as UnknownRecord;
    const rawJp = recordString(record, ["jp", "japanese", "word"]);
    const reading = recordString(record, ["reading", "rd", "yomigana"]);
    const meaningKo = recordString(record, ["meaningKo", "meaning", "kr"]);
    if (!rawJp || !reading || !meaningKo) {
      errors.push({ line: index + 1, text: JSON.stringify(entry), message: "JSON word requires jp, reading/rd, and meaningKo/kr." });
      return;
    }
    const split = splitJapaneseAndNuance(rawJp);
    const explicitNuance = recordString(record, ["nuance"]);
    words.push(normalizeParsedWord({
      jp: split.jp,
      reading,
      meaningKo,
      ...(explicitNuance ? { nuance: explicitNuance } : split.nuance ? { nuance: split.nuance } : {}),
      sourceIndex: recordNumber(record, ["sourceIndex", "n"]) ?? index + 1,
      ...(recordString(record, ["notes"]) && { notes: recordString(record, ["notes"]) }),
    }));
  });

  return { words, errors };
}

function parseMarkdown(lines: string[]): ParsedWordList {
  const tableRows = lines
    .map((line, lineIndex) => ({
      line: lineIndex + 1,
      text: line,
      cells: line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cleanField),
    }))
    .filter(({ cells }) => !isSeparatorRow(cells));

  const header = tableRows[0]?.cells;
  const hasHeader = header ? looksLikeHeader(header) : false;
  let indexes = { jp: 0, reading: 1, meaning: 2, nuance: -1 };
  if (hasHeader && header) {
    const normalized = header.map(normalizedHeader);
    indexes = {
      jp: normalized.findIndex((key) => JP_HEADERS.has(key)),
      reading: normalized.findIndex((key) => READING_HEADERS.has(key)),
      meaning: normalized.findIndex((key) => MEANING_HEADERS.has(key)),
      nuance: normalized.findIndex((key) => NUANCE_HEADERS.has(key)),
    };
  }

  const words: ParsedWord[] = [];
  const errors: ParsedWordList["errors"] = [];
  tableRows.slice(hasHeader ? 1 : 0).forEach((row, rowIndex) => {
    const rawJp = row.cells[indexes.jp] ?? "";
    const reading = row.cells[indexes.reading] ?? "";
    const meaningKo = row.cells[indexes.meaning] ?? "";
    const split = splitJapaneseAndNuance(rawJp);
    const nuance = indexes.nuance >= 0 ? row.cells[indexes.nuance] : split.nuance;
    if (!split.jp || !reading || !meaningKo) {
      errors.push({ line: row.line, text: row.text, message: "Expected Japanese word, reading, and Korean meaning." });
      return;
    }
    words.push(normalizeParsedWord({
      jp: split.jp,
      reading,
      meaningKo,
      ...(nuance && { nuance }),
      sourceIndex: rowIndex + 1,
    }));
  });
  return { words, errors };
}

export function parseWordList(text: string): ParsedWordList {
  const trimmed = text.trim();
  if (!trimmed) return { words: [], errors: [{ line: 1, text: "", message: "Word list is empty." }] };
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return parseJson(trimmed);

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#"));
  const markdown = lines.length >= 2 && lines.every((line) => line.includes("|")) &&
    lines.some((line) => isSeparatorRow(line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|")));
  if (markdown) return parseMarkdown(lines);

  const words: ParsedWord[] = [];
  const errors: ParsedWordList["errors"] = [];
  const firstFields = splitDelimitedLine(lines[0] ?? "");
  const hasHeader = looksLikeHeader(firstFields);
  const normalizedHeaders = firstFields.map(normalizedHeader);
  const headerIndexes = hasHeader ? {
    jp: normalizedHeaders.findIndex((key) => JP_HEADERS.has(key)),
    reading: normalizedHeaders.findIndex((key) => READING_HEADERS.has(key)),
    meaning: normalizedHeaders.findIndex((key) => MEANING_HEADERS.has(key)),
    nuance: normalizedHeaders.findIndex((key) => NUANCE_HEADERS.has(key)),
  } : undefined;

  lines.slice(hasHeader ? 1 : 0).forEach((line, rowIndex) => {
    const lineIndex = rowIndex + (hasHeader ? 1 : 0);
    const fields = splitDelimitedLine(line);
    if (headerIndexes) {
      const split = splitJapaneseAndNuance(fields[headerIndexes.jp] ?? "");
      const reading = fields[headerIndexes.reading] ?? "";
      const meaningKo = fields[headerIndexes.meaning] ?? "";
      const nuance = headerIndexes.nuance >= 0 ? fields[headerIndexes.nuance] : split.nuance;
      if (split.jp && reading && meaningKo) {
        words.push(normalizeParsedWord({
          jp: split.jp,
          reading,
          meaningKo,
          ...(nuance && { nuance }),
          sourceIndex: rowIndex + 1,
        }));
      } else {
        errors.push({ line: lineIndex + 1, text: line, message: "Expected Japanese word, reading, and Korean meaning." });
      }
      return;
    }
    const compactFields = fields.filter((field) => field.length > 0);
    const word = fromFields(compactFields, lineIndex + 1);
    if (word) words.push(word);
    else errors.push({ line: lineIndex + 1, text: line, message: "Expected three fields separated by tabs, two spaces, or CSV commas." });
  });
  return { words, errors };
}
