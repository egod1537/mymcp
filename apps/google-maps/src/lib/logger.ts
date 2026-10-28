export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, fields?: Readonly<Record<string, unknown>>): void;
  info(message: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
  error(message: string, fields?: Readonly<Record<string, unknown>>): void;
}

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const sensitiveField = /(authorization|credential|password|secret|token|api[-_]?key)/i;

function sanitize(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      sensitiveField.test(key) ? '[REDACTED]' : value,
    ]),
  );
}

export function createLogger(component: string, minimumLevel: LogLevel): Logger {
  const write = (
    level: LogLevel,
    message: string,
    fields: Readonly<Record<string, unknown>> = {},
  ): void => {
    if (levelOrder[level] < levelOrder[minimumLevel]) {
      return;
    }
    process.stderr.write(
      `${JSON.stringify({
        ...sanitize(fields),
        timestamp: new Date().toISOString(),
        level,
        component,
        message,
      })}\n`,
    );
  };

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}
