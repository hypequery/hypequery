/**
 * Writes JavaScript values as TypeScript source, the way a person would type
 * them: single-quoted strings, bare keys where they are identifiers, short
 * collections on one line. Output is deterministic for the same input, which
 * is what lets exported code be compared byte for byte.
 */

/** Source text to place as-is, such as `dimension.string()` or a formula. */
export interface Code {
  readonly __code: string;
}

export function code(text: string): Code {
  return { __code: text };
}

function isCode(value: unknown): value is Code {
  return typeof value === 'object' && value !== null && '__code' in value;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in',
  'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try',
  'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'implements', 'interface',
  'package', 'private', 'protected', 'public', 'await', 'arguments', 'eval',
]);

/** True when `name` can be a variable or destructured binding. */
export function isBindingName(name: string): boolean {
  return IDENTIFIER.test(name) && !RESERVED.has(name);
}

/** Single-quoted, or double-quoted when that avoids escaping an apostrophe (as Prettier does). */
export function stringLiteral(value: string): string {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  let out = quote;
  for (const char of value) {
    const point = char.codePointAt(0) as number;
    if (char === '\\') out += '\\\\';
    else if (char === quote) out += `\\${quote}`;
    else if (char === '\n') out += '\\n';
    else if (char === '\r') out += '\\r';
    else if (char === '\t') out += '\\t';
    else if (point < 0x20 || point === 0x7f || point === 0x2028 || point === 0x2029) {
      out += `\\u${point.toString(16).padStart(4, '0')}`;
    } else out += char;
  }
  return `${out}${quote}`;
}

/** An object key: bare when it is an identifier (`__proto__` is always quoted). */
export function propertyKey(key: string): string {
  return IDENTIFIER.test(key) && key !== '__proto__' ? key : stringLiteral(key);
}

const LINE = 100;

/**
 * `value` as source at `indent` (the current line's indentation). Objects and
 * arrays go on one line when that fits in `LINE` columns and holds no nested
 * multi-line value; otherwise one entry per line.
 */
export function literal(value: unknown, indent = ''): string {
  if (isCode(value)) return value.__code;
  if (value === null) return 'null';
  if (typeof value === 'string') return stringLiteral(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Cannot write ${value} as a literal.`);
    return Object.is(value, -0) ? '-0' : String(value);
  }
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map(item => literal(item, inner));
    const flat = `[${items.join(', ')}]`;
    if (!flat.includes('\n') && indent.length + flat.length <= LINE) return flat;
    return `[\n${items.map(item => `${inner}${item},`).join('\n')}\n${indent}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, item]) => item !== undefined,
    );
    if (entries.length === 0) return '{}';
    // `{ datasets }` rather than `{ datasets: datasets }`.
    const items = entries.map(([key, item]) => (
      isCode(item) && item.__code === key && IDENTIFIER.test(key)
        ? key
        : `${propertyKey(key)}: ${literal(item, inner)}`
    ));
    const flat = `{ ${items.join(', ')} }`;
    if (!flat.includes('\n') && indent.length + flat.length <= LINE) return flat;
    return `{\n${items.map(item => `${inner}${item},`).join('\n')}\n${indent}}`;
  }
  throw new Error(`Cannot write a ${typeof value} as a literal.`);
}

/** `name(arg, …)`, dropping trailing `undefined` arguments. */
export function call(name: string, args: readonly unknown[], indent = ''): Code {
  const kept = [...args];
  while (kept.length > 0 && kept[kept.length - 1] === undefined) kept.pop();
  return code(`${name}(${kept.map(arg => literal(arg, indent)).join(', ')})`);
}
