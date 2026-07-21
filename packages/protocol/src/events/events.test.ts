import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ProtocolQueryDiagnosticsError,
  ProtocolQueryEventError,
  validateProtocolQueryDiagnostics,
  validateProtocolQueryEvent,
} from './index.js';

interface SuccessFixture { id: string; value: unknown }
interface RejectionFixture { id: string; generator: { type: string }; error: string }

const EVENT_FAILURE_CODES = [
  'HQ_EVENT_TYPE',
  'HQ_EVENT_UNKNOWN_FIELD',
  'HQ_EVENT_INVALID_VERSION',
  'HQ_EVENT_INVALID_VALUE',
  'HQ_EVENT_TOO_LARGE',
  'HQ_EVENT_UNSAFE_OBJECT',
] as const;

const DIAGNOSTICS_FAILURE_CODES = [
  'HQ_DIAGNOSTICS_TYPE',
  'HQ_DIAGNOSTICS_UNKNOWN_FIELD',
  'HQ_DIAGNOSTICS_INVALID_VERSION',
  'HQ_DIAGNOSTICS_INVALID_VALUE',
  'HQ_DIAGNOSTICS_TOO_LARGE',
  'HQ_DIAGNOSTICS_UNSAFE_OBJECT',
] as const;

function readFixture<T>(directory: string, name: string): T {
  const fixturePath = fileURLToPath(new URL(
    `../../../../specs/security-protocol/fixtures/${directory}/${name}`,
    import.meta.url,
  ));
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as T;
}

function baseEvent() {
  return {
    kind: 'hypequery-query-event',
    version: 1,
    eventId: '0'.repeat(64),
    occurredAt: '2026-07-20T12:34:56.789Z',
    target: { project: 'project_1', environment: 'production' },
    queryName: 'daily_revenue',
    operation: 'query',
    outcome: 'success',
    durationMs: 182,
  };
}

function baseDiagnostics() {
  return {
    kind: 'hypequery-query-diagnostics',
    version: 1,
    eventId: '0'.repeat(64),
    queryId: '1'.repeat(64),
    terminalReason: 'completed',
    attempts: 1,
  };
}

function materializeEvent(type: string): unknown {
  const value = baseEvent();
  switch (type) {
    case 'wrong-root-type': return [];
    case 'missing-required-field': {
      const { durationMs: _omitted, ...rest } = value;
      return rest;
    }
    case 'unknown-sql-field': return { ...value, sql: 'SELECT 1' };
    case 'unknown-parameters-field': return { ...value, parameters: { start: '2026-01-01' } };
    case 'unknown-raw-tenant-field': return { ...value, tenantId: 'acme' };
    case 'newer-version': return { ...value, version: 2 };
    case 'malformed-event-id': return { ...value, eventId: 'bad' };
    case 'invalid-occurred-at': return { ...value, occurredAt: '2026-13-40T99:99:99Z' };
    case 'failure-without-category': return { ...value, outcome: 'failure' };
    case 'success-with-category': return { ...value, errorCategory: 'internal' };
    case 'unknown-error-category': return {
      ...value,
      outcome: 'failure',
      errorCategory: 'exploded',
    };
    case 'negative-duration': return { ...value, durationMs: -1 };
    case 'invalid-target': return {
      ...value,
      target: { project: 'has space', environment: 'production' },
    };
    case 'invalid-query-name': return { ...value, queryName: 'not an identifier' };
    case 'oversized-correlation-id': return { ...value, correlationId: 'x'.repeat(2_049) };
    case 'unsafe-accessor': {
      const unsafe = baseEvent() as Record<string, unknown>;
      Object.defineProperty(unsafe, 'kind', {
        enumerable: true,
        get: () => 'hypequery-query-event',
      });
      return unsafe;
    }
    default: throw new Error(`Unknown fixture generator: ${type}`);
  }
}

function materializeDiagnostics(type: string): unknown {
  const value = baseDiagnostics();
  switch (type) {
    case 'wrong-root-type': return [];
    case 'missing-required-field': {
      const { attempts: _omitted, ...rest } = value;
      return rest;
    }
    case 'unknown-result-field': return { ...value, rows: [[1, 2]] };
    case 'unknown-credentials-field': return { ...value, password: 'hunter2' };
    case 'newer-version': return { ...value, version: 2 };
    case 'malformed-query-id': return { ...value, queryId: 'bad' };
    case 'unknown-terminal-reason': return { ...value, terminalReason: 'exploded' };
    case 'zero-attempts': return { ...value, attempts: 0 };
    case 'control-character-message': return { ...value, safeMessage: 'bad\u0007message' };
    case 'oversized-debug-query': return { ...value, debugQuery: 'x'.repeat(4_097) };
    case 'unsafe-accessor': {
      const unsafe = baseDiagnostics() as Record<string, unknown>;
      Object.defineProperty(unsafe, 'kind', {
        enumerable: true,
        get: () => 'hypequery-query-diagnostics',
      });
      return unsafe;
    }
    default: throw new Error(`Unknown fixture generator: ${type}`);
  }
}

describe('query event v1', () => {
  const success = readFixture<SuccessFixture[]>('query-events-v1', 'success.json');
  const rejections = readFixture<RejectionFixture[]>('query-events-v1', 'rejections.json');

  it('has unique fixtures and covers every stable error code', () => {
    const fixtures = [...success, ...rejections];
    expect(new Set(fixtures.map(fixture => fixture.id)).size).toBe(fixtures.length);
    expect([...new Set(rejections.map(fixture => fixture.error))].sort())
      .toEqual([...EVENT_FAILURE_CODES].sort());
  });

  it.each(success)('accepts $id as an immutable snapshot', ({ value }) => {
    const event = validateProtocolQueryEvent(value);
    expect(event).toEqual(value);
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.target)).toBe(true);
  });

  it.each(rejections)('rejects $id with its stable code', fixture => {
    try {
      validateProtocolQueryEvent(materializeEvent(fixture.generator.type));
      throw new Error('Expected query event validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolQueryEventError);
      expect((error as ProtocolQueryEventError).code).toBe(fixture.error);
    }
  });

  it('lets an older consumer safely reject or ignore an unknown version', () => {
    let code: string | undefined;
    try {
      validateProtocolQueryEvent(materializeEvent('newer-version'));
    } catch (error) {
      code = (error as ProtocolQueryEventError).code;
    }
    expect(code).toBe('HQ_EVENT_INVALID_VERSION');
  });

  it('skips explicit undefined limits and rejects raised limits', () => {
    expect(() => validateProtocolQueryEvent(baseEvent(), {
      limits: { maxStringBytes: undefined },
    })).not.toThrow();
    expect(() => validateProtocolQueryEvent(baseEvent(), {
      limits: { maxStringBytes: 1_025 },
    })).toThrow(/query event v1 maximum/);
  });

  it('honors tightened limits', () => {
    expect(() => validateProtocolQueryEvent(
      { ...baseEvent(), correlationId: 'x'.repeat(17) },
      { limits: { maxStringBytes: 16 } },
    )).toThrow(expect.objectContaining({ code: 'HQ_EVENT_TOO_LARGE' }));
  });

  it('rejects control characters in free-text fields', () => {
    expect(() => validateProtocolQueryEvent({ ...baseEvent(), correlationId: 'bad\u0007id' }))
      .toThrow(expect.objectContaining({ code: 'HQ_EVENT_INVALID_VALUE' }));
  });
});

describe('query diagnostics v1', () => {
  const success = readFixture<SuccessFixture[]>('query-diagnostics-v1', 'success.json');
  const rejections = readFixture<RejectionFixture[]>('query-diagnostics-v1', 'rejections.json');

  it('has unique fixtures and covers every stable error code', () => {
    const fixtures = [...success, ...rejections];
    expect(new Set(fixtures.map(fixture => fixture.id)).size).toBe(fixtures.length);
    expect([...new Set(rejections.map(fixture => fixture.error))].sort())
      .toEqual([...DIAGNOSTICS_FAILURE_CODES].sort());
  });

  it.each(success)('accepts $id as an immutable snapshot', ({ value }) => {
    const diagnostics = validateProtocolQueryDiagnostics(value);
    expect(diagnostics).toEqual(value);
    expect(Object.isFrozen(diagnostics)).toBe(true);
  });

  it.each(rejections)('rejects $id with its stable code', fixture => {
    try {
      validateProtocolQueryDiagnostics(materializeDiagnostics(fixture.generator.type));
      throw new Error('Expected query diagnostics validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolQueryDiagnosticsError);
      expect((error as ProtocolQueryDiagnosticsError).code).toBe(fixture.error);
    }
  });

  it('lets an older consumer safely reject or ignore an unknown version', () => {
    let code: string | undefined;
    try {
      validateProtocolQueryDiagnostics(materializeDiagnostics('newer-version'));
    } catch (error) {
      code = (error as ProtocolQueryDiagnosticsError).code;
    }
    expect(code).toBe('HQ_DIAGNOSTICS_INVALID_VERSION');
  });

  it('skips explicit undefined limits and rejects raised limits', () => {
    expect(() => validateProtocolQueryDiagnostics(baseDiagnostics(), {
      limits: { maxDebugBytes: undefined },
    })).not.toThrow();
    expect(() => validateProtocolQueryDiagnostics(baseDiagnostics(), {
      limits: { maxDebugBytes: 4_097 },
    })).toThrow(/query event v1 maximum/);
  });
});
