export const logLevels = ["debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof logLevels)[number];

const priorities: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.POSITIVE_INFINITY,
};

export class Logger {
  readonly level: LogLevel;

  constructor(level = process.env.LOG_LEVEL ?? "info") {
    this.level = logLevels.includes(level as LogLevel) ? level as LogLevel : "info";
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.write("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.write("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.write("warn", message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.write("error", message, context);
  }

  private write(level: Exclude<LogLevel, "silent">, message: string, context?: Record<string, unknown>): void {
    if (priorities[level] < priorities[this.level]) return;
    process.stderr.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...context })}\n`);
  }
}
