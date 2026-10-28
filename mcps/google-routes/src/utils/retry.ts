export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  shouldRetry: (error: unknown) => boolean;
  onRetry?: (error: unknown, retryNumber: number, delayMs: number) => void;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  let retryNumber = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (retryNumber >= options.maxRetries || !options.shouldRetry(error)) throw error;
      const delayMs = options.baseDelayMs * 2 ** retryNumber;
      retryNumber += 1;
      options.onRetry?.(error, retryNumber, delayMs);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
