const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

export function formatLocalDate(date = new Date()): string {
  return new Date(date.getTime() + SEOUL_OFFSET_MS).toISOString().slice(0, 10);
}

export function formatLocalIso(date = new Date()): string {
  const shifted = new Date(date.getTime() + SEOUL_OFFSET_MS).toISOString().replace("Z", "+09:00");
  return shifted;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}
