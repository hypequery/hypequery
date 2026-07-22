import type { ProtocolIdentifier, TaggedValue } from '@hypequery/protocol';
import {
  COMPILED_QUERY_VERSION,
  COMPILED_SETTING_BOUNDS,
  CompiledQueryError,
  assertNoValuesInSql,
  buildParameterBindings,
  compileQueryV1,
  extractReferencedParameters,
  resolveCompiledDeadline,
  resolveCompiledSettings,
  validateParameterReferences,
  type CompiledParameterDeclaration,
} from './index.js';

const id = (name: string): ProtocolIdentifier => name as ProtocolIdentifier;

const decl = (
  name: string,
  clickHouseType: string,
  logical: CompiledParameterDeclaration['type']['logical'],
  optional = false
): CompiledParameterDeclaration => ({
  name: id(name),
  type: { logical, clickHouseType },
  optional,
});

const uint64 = (value: string): TaggedValue => ({
  $hypequery: { type: 'integer', version: 1, bits: 64, signed: false, value },
});

const uuid = (value: string): TaggedValue => ({
  $hypequery: { type: 'uuid', version: 1, value },
});

describe('CompiledQuery v1 — construction', () => {
  it('builds a versioned query with resolved bindings and never mutates the SQL text', () => {
    const sql = 'SELECT * FROM events WHERE tenant_id = {tenant:String} AND id = {id:UInt64}';
    const compiled = compileQueryV1({
      operation: 'query',
      sql,
      parameters: [decl('tenant', 'String', 'string'), decl('id', 'UInt64', 'integer')],
      values: { tenant: 'acme', id: uint64('42') },
      identifiers: { queryId: 'q-1' },
      sensitivity: { tenantScoped: true, labels: ['pii'] },
    });

    expect(compiled.version).toBe(COMPILED_QUERY_VERSION);
    expect(compiled.operation).toBe('query');
    expect(compiled.sql).toBe(sql); // byte-identical: no substitution happened
    expect(compiled.bindings).toEqual({ tenant: 'acme', id: uint64('42') });
    expect(compiled.sensitivity).toEqual({ tenantScoped: true, labels: ['pii'] });
  });

  it('accepts every RFC 0001 native + tagged parameter shape', () => {
    const compiled = compileQueryV1({
      operation: 'query',
      sql: 'SELECT {a:String}, {b:UInt64}, {c:UUID}, {d:Float64}, {e:Bool}, {f:Nullable(String)}',
      parameters: [
        decl('a', 'String', 'string'),
        decl('b', 'UInt64', 'integer'),
        decl('c', 'UUID', 'uuid'),
        decl('d', 'Float64', 'float'),
        decl('e', 'Bool', 'boolean'),
        decl('f', 'Nullable(String)', 'null'),
      ],
      values: {
        a: 'x',
        b: uint64('7'),
        c: uuid('00000000-0000-0000-0000-000000000000'),
        d: 3.5,
        e: true,
        f: null,
      },
      identifiers: { queryId: 'q-2' },
    });
    expect(Object.keys(compiled.bindings).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('snapshots declarations, tagged values, sensitivity, and debug metadata', () => {
    const parameter = decl('id', 'UInt64', 'integer');
    const value = uint64('7');
    const labels = ['pii'];
    const compiled = compileQueryV1({
      operation: 'query',
      sql: 'SELECT {id:UInt64}',
      parameters: [parameter],
      values: { id: value },
      identifiers: { queryId: 'q-snapshot' },
      sensitivity: { tenantScoped: true, labels },
    });

    expect(Object.isFrozen(compiled)).toBe(true);
    expect(Object.isFrozen(compiled.parameters)).toBe(true);
    expect(Object.isFrozen(compiled.bindings.id)).toBe(true);
    expect(Object.isFrozen(compiled.sensitivity.labels)).toBe(true);
    labels[0] = 'public';
    expect(compiled.sensitivity.labels).toEqual(['pii']);
  });
});

describe('CompiledQuery v1 — no value enters SQL text', () => {
  it('rejects legacy positional placeholders', () => {
    expect(() => assertNoValuesInSql('SELECT * WHERE id = ?', { id: 1 })).toThrow(
      CompiledQueryError
    );
  });

  it('rejects a bound parameter the SQL does not reference', () => {
    expect(() =>
      assertNoValuesInSql('SELECT * FROM t WHERE a = {a:UInt64}', { a: 1, b: 2 })
    ).toThrow(/not referenced/);
  });

  it('extracts only declared placeholder names', () => {
    const names = extractReferencedParameters(
      'SELECT {a:String} WHERE b = {b:UInt64} AND note = 42'
    );
    expect([...names].sort()).toEqual(['a', 'b']);
  });

  it('ignores question marks and placeholder-looking text in literals and comments', () => {
    const sql = "SELECT '?', '{ghost:String}', {id:UInt64} -- {comment:String} ?\n";
    expect([...extractReferencedParameters(sql)]).toEqual(['id']);
    expect(() => assertNoValuesInSql(sql, { id: uint64('1') })).not.toThrow();
  });
});

describe('CompiledQuery v1 — parameter binding fail-closed', () => {
  const params = [decl('tenant', 'String', 'string'), decl('id', 'UInt64', 'integer', true)];

  it('rejects a value for an undeclared parameter', () => {
    expect(() =>
      buildParameterBindings(params, { tenant: 'a', ghost: 'x' })
    ).toThrow(/undeclared parameter ghost/);
  });

  it('rejects a missing required parameter', () => {
    expect(() => buildParameterBindings(params, {})).toThrow(/Required parameter tenant/);
  });

  it('omits an absent optional parameter', () => {
    expect(buildParameterBindings(params, { tenant: 'a' })).toEqual({ tenant: 'a' });
  });

  it('rejects an undeclared placeholder referenced by SQL', () => {
    expect(() =>
      validateParameterReferences('SELECT {ghost:UInt64}', params)
    ).toThrow(/undeclared parameter ghost/);
  });

  it('rejects a placeholder whose ClickHouse type differs from its declaration', () => {
    expect(() =>
      validateParameterReferences('SELECT {id:String}', [decl('id', 'UInt64', 'integer')])
    ).toThrow(/does not match its declared ClickHouse type/);
  });

  it('rejects native values that do not match the logical or ClickHouse type', () => {
    expect(() =>
      buildParameterBindings([decl('id', 'UInt64', 'integer')], { id: 1.5 })
    ).toThrow(CompiledQueryError);
    expect(() =>
      buildParameterBindings([decl('id', 'UUID', 'uuid')], { id: true })
    ).toThrow(CompiledQueryError);
    expect(() =>
      buildParameterBindings([decl('value', 'Float64', 'float')], { value: Number.NaN })
    ).toThrow(CompiledQueryError);
  });

  it('rejects an optional parameter that remains referenced without a binding', () => {
    expect(() => compileQueryV1({
      operation: 'query',
      sql: 'SELECT {optional:String}',
      parameters: [decl('optional', 'String', 'string', true)],
      identifiers: { queryId: 'q-optional' },
    })).toThrow(/does not have a bound value/);
  });

  it('rejects a structurally invalid tagged value', () => {
    const bad = { $hypequery: { type: 'integer', version: 1, bits: 64, signed: false } } as unknown as TaggedValue;
    expect(() => buildParameterBindings(params, { tenant: bad })).toThrow(CompiledQueryError);
  });
});

describe('CompiledQuery v1 — settings allow-list', () => {
  it('passes settings within their inclusive range through unchanged', () => {
    expect(resolveCompiledSettings({ maxExecutionMs: 5000, maxResultRows: 100 })).toEqual({
      maxExecutionMs: 5000,
      maxResultRows: 100,
    });
  });

  it('rejects a setting above its ceiling', () => {
    expect(() =>
      resolveCompiledSettings({ maxExecutionMs: COMPILED_SETTING_BOUNDS.maxExecutionMs.max + 1 })
    ).toThrow(/outside its allowed range/);
  });

  it('rejects a non-integer setting', () => {
    expect(() => resolveCompiledSettings({ maxResultRows: 1.5 })).toThrow(CompiledQueryError);
  });
});

describe('CompiledQuery v1 — deadline precedence', () => {
  const now = 1_000_000;

  it('takes the earlier of caller and policy', () => {
    expect(
      resolveCompiledDeadline({ callerAtEpochMs: now + 100, policyMaxMs: 500, nowEpochMs: now })
    ).toEqual({ atEpochMs: now + 100, source: 'caller' });
    expect(
      resolveCompiledDeadline({ callerAtEpochMs: now + 900, policyMaxMs: 500, nowEpochMs: now })
    ).toEqual({ atEpochMs: now + 500, source: 'policy' });
  });

  it('never extends beyond the policy ceiling when the caller asks for more', () => {
    const resolved = resolveCompiledDeadline({
      callerAtEpochMs: now + 10_000,
      policyMaxMs: 500,
      nowEpochMs: now,
    });
    expect(resolved).toEqual({ atEpochMs: now + 500, source: 'policy' });
  });

  it('fails immediately when the caller deadline is at or before now', () => {
    expect(() =>
      resolveCompiledDeadline({ callerAtEpochMs: now, nowEpochMs: now })
    ).toThrow(/at or before the current time/);
  });

  it('returns undefined when neither deadline is present', () => {
    expect(resolveCompiledDeadline({ nowEpochMs: now })).toBeUndefined();
  });

  it('rejects non-finite, negative, and overflowing deadline inputs', () => {
    expect(() => resolveCompiledDeadline({ nowEpochMs: Number.NaN })).toThrow();
    expect(() => resolveCompiledDeadline({ nowEpochMs: now, policyMaxMs: -1 })).toThrow();
    expect(() => resolveCompiledDeadline({
      nowEpochMs: Number.MAX_SAFE_INTEGER,
      policyMaxMs: 1,
    })).toThrow();
  });

  it('tightens the policy deadline to maxExecutionMs', () => {
    const compiled = compileQueryV1({
      operation: 'query',
      sql: 'SELECT 1',
      settings: { maxExecutionMs: 100 },
      deadline: { nowEpochMs: now, policyMaxMs: 500 },
      identifiers: { queryId: 'q-deadline' },
    });
    expect(compiled.deadline).toEqual({ atEpochMs: now + 100, source: 'policy' });
  });
});

describe('CompiledQuery v1 — debug form redaction', () => {
  it('shows placeholders + types, hides values, and is non-executable', () => {
    const compiled = compileQueryV1({
      operation: 'query',
      sql: 'SELECT * FROM t WHERE tenant = {tenant:String} AND id = {id:UInt64}',
      parameters: [decl('tenant', 'String', 'string'), decl('id', 'UInt64', 'integer')],
      values: { tenant: 'secret-tenant', id: uint64('42') },
      settings: { maxExecutionMs: 5000 },
      identifiers: { queryId: 'q-3' },
    });

    expect(compiled.debug.sql).not.toContain('secret-tenant');
    expect(compiled.debug.sql).not.toContain('42');
    expect(compiled.debug.sql).toContain('«param tenant: String»');
    // Non-executable: no native placeholder braces survive in the debug SQL.
    expect(compiled.debug.sql).not.toMatch(/\{[^}]*:[^}]*\}/);
    // Setting names only, never values.
    expect(compiled.debug.settings).toEqual(['maxExecutionMs']);
    expect(JSON.stringify(compiled.debug)).not.toContain('5000');
  });
});

describe('CompiledQuery v1 — error envelope', () => {
  it('keeps a safe caller message for client-fault categories', () => {
    const err = new CompiledQueryError('input-invalid', 'name is not declared', {
      queryId: 'q-4',
    });
    expect(err.toEnvelope()).toEqual({
      category: 'input-invalid',
      message: 'name is not declared',
      queryId: 'q-4',
    });
  });

  it('redacts server-fault messages regardless of the supplied text', () => {
    const err = new CompiledQueryError('internal', 'DB::Exception: table events on shard 3', {
      queryId: 'q-5',
      cause: new Error('raw adapter text'),
    });
    expect(err.message).not.toContain('events');
    expect(err.message).not.toContain('shard');
    expect(err.toEnvelope()).toEqual({
      category: 'internal',
      message: 'The request could not be completed.',
      queryId: 'q-5',
    });
  });

  it('drops multi-line client messages to a safe default', () => {
    const err = new CompiledQueryError('forbidden', 'line1\nline2');
    expect(err.message).toBe('Access is denied.');
  });
});

describe('CompiledQuery v1 — identifiers', () => {
  const base = {
    operation: 'query' as const,
    sql: 'SELECT 1',
    identifiers: { queryId: 'q-6' },
  };

  it('rejects a missing authoritative query id', () => {
    expect(() => compileQueryV1({ ...base, identifiers: { queryId: '' } })).toThrow(
      CompiledQueryError
    );
  });

  it('rejects a correlation id with control characters', () => {
    expect(() =>
      compileQueryV1({ ...base, identifiers: { queryId: 'q', correlationId: 'a\u0001b' } })
    ).toThrow(/control characters/);
  });

  it('rejects unsafe authoritative ids and C1 correlation controls', () => {
    expect(() => compileQueryV1({
      ...base,
      identifiers: { queryId: 'q\nspoofed' },
    })).toThrow(CompiledQueryError);
    expect(() => compileQueryV1({
      ...base,
      identifiers: { queryId: 'q', correlationId: 'a\u0085b' },
    })).toThrow(/control characters/);
  });

  it('rejects an oversized correlation id', () => {
    expect(() =>
      compileQueryV1({
        ...base,
        identifiers: { queryId: 'q', correlationId: 'x'.repeat(1025) },
      })
    ).toThrow(/exceeds the allowed size/);
  });
});
