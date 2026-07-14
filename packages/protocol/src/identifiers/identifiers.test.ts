import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ProtocolIdentifierError,
  isProtocolIdentifier,
  isProtocolQualifiedIdentifier,
  joinProtocolQualifiedIdentifier,
  parseProtocolIdentifier,
  parseProtocolQualifiedIdentifier,
  splitProtocolQualifiedIdentifier,
} from './index.js';

type Mode = 'simple' | 'qualified';

interface SuccessFixture {
  id: string;
  mode: Mode;
  value: string;
  segments: string[];
}

interface RejectionFixture {
  id: string;
  mode: Mode;
  value?: unknown;
  generator?: {
    type: 'repeat-string' | 'qualified-segments';
    value?: string;
    segment?: string;
    count: number;
  };
  error: string;
}

const FAILURE_CODES = [
  'HQ_IDENTIFIER_TYPE',
  'HQ_IDENTIFIER_EMPTY',
  'HQ_IDENTIFIER_TOO_LONG',
  'HQ_IDENTIFIER_INVALID_FORMAT',
  'HQ_IDENTIFIER_RESERVED',
  'HQ_IDENTIFIER_TOO_MANY_SEGMENTS',
] as const;

function readFixture<T>(name: string): T {
  const path = fileURLToPath(new URL(
    `../../../../specs/security-protocol/fixtures/identifiers-v1/${name}`,
    import.meta.url,
  ));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function materialize(fixture: RejectionFixture): unknown {
  if (!fixture.generator) return fixture.value;
  if (fixture.generator.type === 'repeat-string') {
    return (fixture.generator.value ?? '').repeat(fixture.generator.count);
  }
  return Array.from(
    { length: fixture.generator.count },
    () => fixture.generator?.segment ?? '',
  ).join('.');
}

describe('portable protocol identifiers', () => {
  const success = readFixture<SuccessFixture[]>('success.json');
  const rejections = readFixture<RejectionFixture[]>('rejections.json');

  it('has unique fixture IDs and covers every stable failure code', () => {
    const ids = [...success, ...rejections].map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...new Set(rejections.map((fixture) => fixture.error))].sort())
      .toEqual([...FAILURE_CODES].sort());
  });

  it.each(success)('$id preserves its exact spelling', (fixture) => {
    if (fixture.mode === 'simple') {
      expect(parseProtocolIdentifier(fixture.value)).toBe(fixture.value);
      expect(fixture.segments).toEqual([fixture.value]);
      return;
    }
    const parsed = parseProtocolQualifiedIdentifier(fixture.value);
    expect(parsed).toBe(fixture.value);
    expect(splitProtocolQualifiedIdentifier(parsed)).toEqual(fixture.segments);
    expect(joinProtocolQualifiedIdentifier(fixture.segments)).toBe(fixture.value);
  });

  it.each(rejections)('rejects $id with its stable code', (fixture) => {
    const action = fixture.mode === 'simple'
      ? () => parseProtocolIdentifier(materialize(fixture))
      : () => parseProtocolQualifiedIdentifier(materialize(fixture));
    expect(action).toThrow(ProtocolIdentifierError);
    try {
      action();
    } catch (error) {
      expect((error as ProtocolIdentifierError).code).toBe(fixture.error);
      expect((error as Error).message).toBe(fixture.error);
    }
  });

  it('provides non-throwing guards', () => {
    expect(isProtocolIdentifier('RevenueByDay')).toBe(true);
    expect(isProtocolIdentifier('orders.customer')).toBe(false);
    expect(isProtocolQualifiedIdentifier('orders.customer')).toBe(true);
    expect(isProtocolQualifiedIdentifier('orders..customer')).toBe(false);
  });

  it('enforces exact segment, qualified-byte, and segment-count boundaries', () => {
    const maxSegment = 'a'.repeat(128);
    const qualifiedAt511Bytes = Array.from({ length: 4 }, () => 'a'.repeat(127)).join('.');
    const qualifiedAt515Bytes = Array.from({ length: 4 }, () => maxSegment).join('.');
    const eightSegments = Array.from({ length: 8 }, () => 'a').join('.');

    expect(parseProtocolIdentifier(maxSegment)).toBe(maxSegment);
    expect(parseProtocolQualifiedIdentifier(qualifiedAt511Bytes)).toBe(qualifiedAt511Bytes);
    expect(parseProtocolQualifiedIdentifier(eightSegments)).toBe(eightSegments);

    for (const value of ['a'.repeat(129), qualifiedAt515Bytes]) {
      try {
        parseProtocolQualifiedIdentifier(value);
        throw new Error('Expected identifier validation to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(ProtocolIdentifierError);
        expect((error as ProtocolIdentifierError).code).toBe('HQ_IDENTIFIER_TOO_LONG');
      }
    }
  });
});
