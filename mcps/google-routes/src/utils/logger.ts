type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

const PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = (process.env.LOG_LEVEL ?? "info").toLowerCase();
const minimumLevel: LogLevel = configuredLevel in PRIORITY ? (configuredLevel as LogLevel) : "info";

function write(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
  if (PRIORITY[level] < PRIORITY[minimumLevel]) return;
  process.stderr.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...metadata })}\n`,
  );
}

export const logger: Logger = {
  debug: (message: string, metadata?: Record<string, unknown>) => write("debug", message, metadata),
  info: (message: string, metadata?: Record<string, unknown>) => write("info", message, metadata),
  warn: (message: string, metadata?: Record<string, unknown>) => write("warn", message, metadata),
  error: (message: string, metadata?: Record<string, unknown>) => write("error", message, metadata),
};
