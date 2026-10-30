/**
 * One argument as a POSIX shell word, for commands printed for the user to
 * copy. Plain words stay as they are; anything else is single-quoted.
 */
export function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=@%+-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}
