export class HttpResultJsonBudgetError extends Error {
  constructor() { super('HTTP result JSON exceeds validation limits.'); }
}

/** Budget/duplicate scan before native JSON parsing. Scalars retain HTTP binary64 semantics, including -0. */
export function decodeHttpResultJson(text: string): unknown {
  if (Buffer.byteLength(text) > 1_048_576) throw new HttpResultJsonBudgetError();
  const stack: { object: boolean; keys: Set<string>; key: boolean; count: number }[] = [];
  let nodes = 0;
  let position = 0;
  const value = () => {
    if (++nodes > 10_000) throw new HttpResultJsonBudgetError();
    const parent = stack[stack.length - 1];
    if (parent && !parent.object && ++parent.count > 1000) throw new HttpResultJsonBudgetError();
  };
  while (position < text.length) {
    const character = text[position];
    if (' \t\r\n:'.includes(character)) { position++; continue; }
    if (character === ',') {
      const parent = stack[stack.length - 1];
      if (parent?.object) parent.key = true;
      position++;
      continue;
    }
    if (character === '{' || character === '[') {
      value();
      if (stack.length >= 16) throw new HttpResultJsonBudgetError();
      stack.push({ object: character === '{', keys: new Set(), key: character === '{', count: 0 });
      position++;
      continue;
    }
    if (character === '}' || character === ']') { stack.pop(); position++; continue; }
    if (character === '"') {
      const start = position++;
      let closed = false;
      while (position < text.length) {
        const current = text[position++];
        if (current === '\\') position++;
        else if (current === '"') { closed = true; break; }
      }
      if (!closed) throw new Error('Invalid JSON string');
      const parent = stack[stack.length - 1];
      if (parent?.object && parent.key) {
        const key = JSON.parse(text.slice(start, position)) as string;
        if (parent.keys.has(key)) throw new Error('Duplicate JSON member');
        parent.keys.add(key);
        if (parent.keys.size > 1000) throw new HttpResultJsonBudgetError();
        parent.key = false;
      } else value();
      continue;
    }
    value();
    position++;
    while (position < text.length && !' \t\r\n,]}:{["'.includes(text[position])) position++;
  }
  // Native parsing owns JSON grammar validation; the scan only adds budgets and duplicate refusal.
  return JSON.parse(text) as unknown;
}
