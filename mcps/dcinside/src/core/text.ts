export function sanitizeStoredText(value: string): string {
  let sanitized = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const isAllowedWhitespace = codePoint === 9 || codePoint === 10 || codePoint === 13;
    const isUnsafeControl =
      (codePoint >= 0 && codePoint <= 31 && !isAllowedWhitespace) ||
      (codePoint >= 127 && codePoint <= 159);
    if (!isUnsafeControl) sanitized += character;
  }
  return sanitized;
}
