import { skipNonCode } from './sql-parens.js';

/** Split type arguments without treating quoted or nested commas as separators. */
function splitTypeArguments(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < input.length) {
    const end = skipNonCode(input, i);
    if (end !== undefined) {
      i = end;
      continue;
    }
    if (input[i] === '(') depth += 1;
    if (input[i] === ')') depth -= 1;
    if (input[i] === ',' && depth === 0) {
      parts.push(input.slice(start, i).trim());
      start = i + 1;
    }
    i += 1;
  }
  if (input.slice(start).trim()) parts.push(input.slice(start).trim());
  return parts;
}

export function parseParameterType(type: string): { name: string; args: string[] } {
  const match = /^([A-Za-z][A-Za-z0-9]*)\s*(?:\(([\s\S]*)\))?$/.exec(type.trim());
  if (!match) throw new Error(`Cannot serialize parameter with type ${type}`);
  return { name: match[1]!, args: match[2] === undefined ? [] : splitTypeArguments(match[2]) };
}

/** Named tuple fields can still be supplied positionally as JavaScript arrays. */
export function parseTupleField(field: string): { name?: string; type: string } {
  if (field[0] === '`' || field[0] === '"') {
    const end = skipNonCode(field, 0)!;
    const quote = field[0];
    const name = field.slice(1, end - 1)
      .replace(new RegExp(`${quote}${quote}`, 'g'), quote)
      .replace(/\\(.)/gs, (_, char: string) => ({ n: '\n', r: '\r', t: '\t', '0': '\0', b: '\b', f: '\f' }[char] ?? char));
    return { name, type: field.slice(end).trim() };
  }
  const named = /^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z][\s\S]*)$/.exec(field);
  return named ? { name: named[1]!, type: named[2]! } : { type: field };
}
