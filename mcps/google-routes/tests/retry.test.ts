import { afterEach, describe, expect, it, vi } from "vitest";
import { withRetry } from "../src/utils/retry.js";

afterEach(() => vi.useRealTimers());

describe("retry", () => {
  it("uses 500ms, 1s, and 2s exponential backoff for three retries", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const delays: number[] = [];
    const promise = withRetry(async () => {
      attempts += 1;
      if (attempts < 4) throw new TypeError("temporary network error");
      return "ok";
    }, {
      maxRetries: 3,
      baseDelayMs: 500,
      shouldRetry: (error) => error instanceof TypeError,
      onRetry: (_error, _retryNumber, delayMs) => delays.push(delayMs),
    });

    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("ok");
    expect(attempts).toBe(4);
    expect(delays).toEqual([500, 1000, 2000]);
  });

  it("does not retry rejected non-retryable errors", async () => {
    const operation = vi.fn(async () => {
      throw new Error("invalid argument");
    });
    await expect(withRetry(operation, {
      maxRetries: 3,
      baseDelayMs: 500,
      shouldRetry: () => false,
    })).rejects.toThrow("invalid argument");
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
