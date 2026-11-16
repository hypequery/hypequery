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
