import { describe, expect, it } from "vitest";
import { createCacheKey } from "../src/utils/cache.js";

describe("cache keys", () => {
  it("stabilizes object key order", () => {
    expect(createCacheKey("route", { destination: "B", origin: "A" })).toBe(
      createCacheKey("route", { origin: "A", destination: "B" }),
    );
  });

  it("preserves array order and departure time", () => {
    const first = createCacheKey("matrix", {
      origins: ["A", "B"],
      destinations: ["C"],
      departureTime: "2026-10-10T10:00:00+09:00",
    });
    const reordered = createCacheKey("matrix", {
      origins: ["B", "A"],
      destinations: ["C"],
      departureTime: "2026-10-10T10:00:00+09:00",
    });
    const differentTime = createCacheKey("matrix", {
      origins: ["A", "B"],
      destinations: ["C"],
      departureTime: "2026-10-10T11:00:00+09:00",
    });
    expect(first).not.toBe(reordered);
    expect(first).not.toBe(differentTime);
  });
});
