export type LogFields = Readonly<Record<string, string | number | boolean | null>>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
}

const sensitiveKey = /(authorization|credential|password|secret|token|api[-_]?key)/i;

function sanitize(fields: LogFields): LogFields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      sensitiveKey.test(key) ? '[REDACTED]' : value,
    ]),
  );
}

export function createLogger(component: string): Logger {
  const write = (level: string, message: string, fields: LogFields = {}): void => {
    const entry = {
      ...sanitize(fields),
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
    };

    process.stderr.write(`${JSON.stringify(entry)}\n`);
  };

  return {
    debug: (message, fields) => write('debug', message, fields),
    error: (message, fields) => write('error', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
  };
}
