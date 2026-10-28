type LogLevel = "debug" | "info" | "warn" | "error";

const PRIORITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

function configuredLevel(): LogLevel {
  const value = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return value in PRIORITY ? value as LogLevel : "info";
}

function write(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
  if (PRIORITY[level] < PRIORITY[configuredLevel()]) return;
  process.stderr.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...metadata })}\n`);
}

export const logger: Logger = {
  debug: (message, metadata) => write("debug", message, metadata),
  info: (message, metadata) => write("info", message, metadata),
  warn: (message, metadata) => write("warn", message, metadata),
  error: (message, metadata) => write("error", message, metadata),
};
