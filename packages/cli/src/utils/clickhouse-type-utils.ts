export function splitTopLevelArgs(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote: "'" | '"' | '`' | null = null;
  let escaped = false;

  for (const char of value) {
    if (quote) {
      current += char;
      // ClickHouse escapes a quote inside a literal with a backslash (`'can\'t'`).
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      current += char;
      continue;
    }

    if (char === '(') {
      depth += 1;
      current += char;
      continue;
    }

    if (char === ')') {
      depth -= 1;
      current += char;
      continue;
    }

    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

export function unwrapType(type: string, wrapperName: string): string | null {
  const prefix = `${wrapperName}(`;
  return type.startsWith(prefix) && type.endsWith(')') ? type.slice(prefix.length, -1) : null;
}

export function matchTypeCall(type: string, name: string): string[] | null {
  const inner = unwrapType(type, name);
  return inner === null ? null : splitTopLevelArgs(inner);
}

export function unquoteClickHouseString(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function isIntegerLiteral(value: string) {
  return /^\d+$/.test(value.trim());
}
