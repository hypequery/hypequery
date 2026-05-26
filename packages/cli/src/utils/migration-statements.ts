import { sha256 } from './sha256.js';

const BREAKPOINT_PATTERN = /^\s*--\s*hypequery:breakpoint\s*$/i;

export function splitMigrationStatements(sql: string): string[] {
  const byBreakpoint = sql
    .split(/\r?\n/)
    .reduce<string[]>((parts, line) => {
      if (BREAKPOINT_PATTERN.test(line)) {
        parts.push('');
        return parts;
      }
      parts[parts.length - 1] = `${parts[parts.length - 1]}${line}\n`;
      return parts;
    }, [''])
    .map(statement => statement.trim())
    .filter(hasExecutableSql);

  if (byBreakpoint.length > 1) {
    return byBreakpoint;
  }

  return splitSqlBySemicolon(sql);
}

export function hashStatement(statement: string) {
  return sha256(statement.trim());
}

function splitSqlBySemicolon(sql: string) {
  const statements: string[] = [];
  let current = '';
  let quote: "'" | '"' | '`' | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (blockComment) {
      current += char;
      if (char === '*' && next === '/') {
        current += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }

    if (lineComment) {
      current += char;
      if (char === '\n') {
        lineComment = false;
      }
      continue;
    }

    if (!quote && char === '/' && next === '*') {
      blockComment = true;
      current += char;
      continue;
    }

    if (!quote && char === '-' && next === '-') {
      lineComment = true;
      current += char;
      continue;
    }

    if (quote) {
      current += char;
      if (char === '\\') {
        current += next ?? '';
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      current += char;
      continue;
    }

    if (char === ';') {
      const statement = current.trim();
      if (hasExecutableSql(statement)) {
        statements.push(`${statement};`);
      }
      current = '';
      continue;
    }

    current += char;
  }

  const trailing = current.trim();
  if (hasExecutableSql(trailing)) {
    statements.push(trailing);
  }

  return statements;
}

function hasExecutableSql(statement: string) {
  let quote: "'" | '"' | '`' | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < statement.length; index += 1) {
    const char = statement[index];
    const next = statement[index + 1];

    if (blockComment) {
      if (char === '*' && next === '/') {
        index += 1;
        blockComment = false;
      }
      continue;
    }

    if (lineComment) {
      if (char === '\n') {
        lineComment = false;
      }
      continue;
    }

    if (!quote && char === '-' && next === '-') {
      lineComment = true;
      index += 1;
      continue;
    }

    if (!quote && char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }

    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      return true;
    }

    if (!/\s/.test(char)) {
      return true;
    }
  }

  return false;
}
