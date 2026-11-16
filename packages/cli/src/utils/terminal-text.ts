/**
 * Control characters a terminal may act on: C0 (except tab, and newline when
 * the text may span lines), DEL, and C1, which includes the single-byte CSI
 * 0x9b. ESC (0x1b) is in C0.
 */
const SINGLE_LINE = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g;
const MULTI_LINE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/**
 * Text from outside the CLI (ClickHouse names, comments and messages, engine
 * findings) as it may reach a terminal: every control character becomes a
 * space, so the text can't move the cursor, change colours, rewrite earlier
 * lines or set the window title. Machine output (`--json`) doesn't need this:
 * JSON escapes control characters.
 */
export function terminalText(value: string, options: { readonly multiline?: boolean } = {}): string {
  return value.replace(options.multiline ? MULTI_LINE : SINGLE_LINE, ' ');
}

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
