/**
 * Text a server sent that the CLI prints: error messages, hints and details
 * from Cloud or a deployment endpoint. C0 and C1 control characters and DEL
 * become spaces, so the text cannot carry ANSI escape sequences (which can
 * rewrite earlier terminal output, set the window title or hide text), and
 * the length is bounded. Empty or non-string input gives `undefined`.
 */
export function terminalSafeText(value: unknown, maxLength = 512): string | undefined {
  if (typeof value !== 'string') return undefined;
  const safe = [...value].map(character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ? ' ' : character;
  }).join('').slice(0, maxLength).trim();
  return safe || undefined;
}
