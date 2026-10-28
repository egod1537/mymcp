import type { DistributionStrategy, JapaneseWord } from "./types.js";

export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = items.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target]!, result[index]!];
  }
  return result;
}

export function selectDailyWords(
  candidates: JapaneseWord[],
  count: number,
  strategy: DistributionStrategy,
  random: () => number = Math.random,
): JapaneseWord[] {
  if (strategy === "random") return shuffle(candidates, random).slice(0, count);
  if (strategy === "mixed") {
    const oldestCount = Math.ceil(count / 2);
    const oldest = candidates.slice(0, oldestCount);
    const used = new Set(oldest.map((word) => word.id));
    return [...oldest, ...shuffle(candidates.filter((word) => !used.has(word.id)), random)]
      .slice(0, count);
  }
  return candidates.slice(0, count);
}
