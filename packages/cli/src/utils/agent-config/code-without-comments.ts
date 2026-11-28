/**
 * TypeScript or JavaScript source with comments removed and string contents
 * blanked, for spotting a setting such as `tenantKey:` without matching a
 * commented-out example (`// tenantKey: 'account_id'`) or text in a string.
 * A small scanner, not a parser: it tracks quotes, template literals and the
 * two comment forms, which is all this needs.
 */
export function codeWithoutComments(source: string): string {
  let output = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? source.length : end + 2;
      output += ' ';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      output += char;
      index += 1;
      while (index < source.length && source[index] !== char) {
        if (source[index] === '\\') index += 1;
        else if (char !== '`' && source[index] === '\n') break;
        index += 1;
      }
      output += char;
      index += 1;
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}
