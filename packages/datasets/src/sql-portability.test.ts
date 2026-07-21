import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateProtocolExpression } from '@hypequery/protocol';
import {
  compilePortableSqlExpression,
  DEFAULT_SQL_PORTABILITY_LIMITS,
} from './sql-portability.js';

interface PortableFixture {
  id: string;
  sql: string;
  expression: unknown;
  dependencies: readonly string[];
}

interface NonPortableFixture {
  id: string;
  sql: string;
  code: string;
  start: number;
}

const ISSUE_CODES = [
  'HQ_SQL_PORT_SYNTAX',
  'HQ_SQL_PORT_UNSUPPORTED_FUNCTION',
  'HQ_SQL_PORT_UNSUPPORTED_OPERATOR',
  'HQ_SQL_PORT_UNSUPPORTED_LITERAL',
  'HQ_SQL_PORT_UNSUPPORTED_SYNTAX',
  'HQ_SQL_PORT_TOO_COMPLEX',
  'HQ_SQL_PORT_TOO_LARGE',
] as const;

function readFixture<T>(name: string): T {
  const fixturePath = fileURLToPath(new URL(
    `../../../specs/security-protocol/fixtures/sql-portability-v1/${name}`,
    import.meta.url,
  ));
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as T;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const FUZZ_ALPHABET = [
  'a', 'b', 'orders.total', '`weird name`', 'revenue', '0', '1', '-1', '3.14',
  "'x'", "'it''s'", "'unclosed", 'TRUE', 'FALSE', 'NULL', 'AND', 'OR', 'NOT',
  'IN', 'BETWEEN', 'LIKE', 'SELECT', 'CASE', 'coalesce', 'nullIfZero', 'round',
  'floor', 'ceil', 'lower', 'arrayMap', '+', '-', '*', '/', '%', '=', '!=',
  '<>', '>', '<', '(', ')', ',', ';', '::', '->', '--', '/*', '[', ']',
] as const;

describe('SQL portability compiler v1', () => {
  const portable = readFixture<PortableFixture[]>('portable.json');
  const nonPortable = readFixture<NonPortableFixture[]>('non-portable.json');

  it('has unique fixtures and covers every issue code', () => {
    const fixtures = [...portable, ...nonPortable];
    expect(new Set(fixtures.map(fixture => fixture.id)).size).toBe(fixtures.length);
    for (const code of ISSUE_CODES) {
      expect(
        nonPortable.some(fixture => fixture.code === code),
        `missing fixture for ${code}`,
      ).toBe(true);
    }
  });

  it.each(portable)('compiles $id to the expected AST', fixture => {
    const result = compilePortableSqlExpression(fixture.sql);
    expect(result.portable).toBe(true);
    if (!result.portable) return;
    expect(result.expression).toEqual(fixture.expression);
    expect(result.dependencies).toEqual(fixture.dependencies);
    expect(Object.isFrozen(result.expression)).toBe(true);
  });

  it.each(nonPortable)('rejects $id with its stable code', fixture => {
    const result = compilePortableSqlExpression(fixture.sql);
    expect(result.portable).toBe(false);
    if (result.portable) return;
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]!.code).toBe(fixture.code);
    expect(result.issues[0]!.start).toBe(fixture.start);
    expect(result.issues[0]!.end).toBeGreaterThanOrEqual(result.issues[0]!.start);
  });

  it('deduplicates and sorts dependencies', () => {
    const result = compilePortableSqlExpression('b + a * b - c.d');
    expect(result.portable).toBe(true);
    if (result.portable) expect(result.dependencies).toEqual(['a', 'b', 'c.d']);
  });

  it('rejects raised limits and honors tightened limits', () => {
    expect(() => compilePortableSqlExpression('a', {
      limits: { maxDepth: DEFAULT_SQL_PORTABILITY_LIMITS.maxDepth + 1 },
    })).toThrow(/SQL portability v1 maximum/);
    expect(compilePortableSqlExpression('((a))', { limits: { maxDepth: 1 } }))
      .toMatchObject({ portable: false, issues: [{ code: 'HQ_SQL_PORT_TOO_COMPLEX' }] });
    expect(compilePortableSqlExpression('a + b + c', { limits: { maxNodes: 2 } }))
      .toMatchObject({ portable: false, issues: [{ code: 'HQ_SQL_PORT_TOO_COMPLEX' }] });
    expect(compilePortableSqlExpression('a'.repeat(300), { limits: { maxInputBytes: 16 } }))
      .toMatchObject({ portable: false, issues: [{ code: 'HQ_SQL_PORT_TOO_LARGE' }] });
    expect(compilePortableSqlExpression('((a))', { limits: { maxDepth: undefined } }).portable)
      .toBe(true);
  });

  it('accepts common supported measure expressions', () => {
    for (const sql of [
      'price * quantity',
      'revenue / nullIfZero(orders)',
      'coalesce(discount, 0) * price',
      'round((price - cost) / nullIfZero(price), 4)',
      'floor(score / 10) * 10',
    ]) {
      expect(compilePortableSqlExpression(sql).portable, sql).toBe(true);
    }
  });

  it('fuzzes the corpus within bounded time without throwing', () => {
    const random = mulberry32(0x5eed);
    const corpus = portable.map(fixture => fixture.sql);
    const started = Date.now();
    for (let iteration = 0; iteration < 2_000; iteration += 1) {
      let sql: string;
      if (iteration % 2 === 0 && corpus.length > 0) {
        sql = corpus[Math.floor(random() * corpus.length)]!;
        const cut = Math.floor(random() * (sql.length + 1));
        const insert = FUZZ_ALPHABET[Math.floor(random() * FUZZ_ALPHABET.length)]!;
        sql = `${sql.slice(0, cut)}${insert}${sql.slice(cut)}`;
      } else {
        const length = Math.floor(random() * 12);
        const parts: string[] = [];
        for (let index = 0; index < length; index += 1) {
          parts.push(FUZZ_ALPHABET[Math.floor(random() * FUZZ_ALPHABET.length)]!);
        }
        sql = parts.join(' ');
      }
      let result: ReturnType<typeof compilePortableSqlExpression> | undefined;
      expect(() => {
        result = compilePortableSqlExpression(sql);
      }).not.toThrow();
      expect(result).toBeDefined();
      if (result!.portable) {
        expect(() => validateProtocolExpression(result!.expression)).not.toThrow();
        const sorted = [...result!.dependencies].sort();
        expect(result!.dependencies).toEqual(sorted);
      } else {
        expect(result!.issues.length).toBeGreaterThan(0);
        for (const issue of result!.issues) {
          expect(ISSUE_CODES).toContain(issue.code);
          expect(issue.start).toBeGreaterThanOrEqual(0);
          expect(issue.end).toBeGreaterThanOrEqual(issue.start);
          expect(issue.end).toBeLessThanOrEqual(sql.length);
        }
      }
    }
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
