import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emitType } from './json-schema-to-ts.ts';
import { GENERATED_PATH, SPEC_PATH } from './paths.ts';
import { assertSpec, clientInputSchema, renderClientModule, typeBaseName, type OperationsSpec } from './render.ts';
import { diffSpecs, formatDiff, isEmptyDiff } from './spec-diff.ts';

const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as OperationsSpec;

function minimalSpec(overrides: Partial<OperationsSpec> = {}): OperationsSpec {
  return {
    kind: 'hypequery-cloud-operations',
    version: 1,
    basePath: '/v1',
    errorCategories: ['correctable_input'],
    errors: {
      INVALID_INPUT: { status: 400, category: 'correctable_input', retryable: false, hint: 'Fix it.', docsUrl: 'https://x/e' },
    },
    operations: [
      {
        name: 'widgets.remove',
        summary: 'Remove a widget.',
        scope: 'project',
        capability: 'widgets:manage',
        destructive: true,
        http: { method: 'DELETE', path: '/projects/{project}/widgets/{widget}' },
        input: {
          type: 'object',
          properties: { project: { type: 'string' }, widget: { type: 'string' } },
          required: ['project', 'widget'],
        },
        output: { type: 'object', properties: { removed: { type: 'boolean', const: true } }, required: ['removed'] },
        errors: ['INVALID_INPUT'],
      },
    ],
    ...overrides,
  };
}

describe('generated client', () => {
  it('is up to date with specs/cloud-api/operations-v1.json', () => {
    // Run `pnpm --filter @hypequery/cloud-client generate` when this fails.
    expect(readFileSync(GENERATED_PATH, 'utf8')).toBe(renderClientModule(spec));
  });

  it('renders the same bytes every time', () => {
    expect(renderClientModule(spec)).toBe(renderClientModule(JSON.parse(JSON.stringify(spec))));
  });

  it('has one method per operation', () => {
    const source = renderClientModule(spec);
    for (const operation of spec.operations) {
      const base = typeBaseName(operation.name);
      expect(source).toMatch(new RegExp(`export (interface|type) ${base}Input\\b`));
      expect(source).toContain(`Promise<${base}Output>`);
    }
  });

  it('matches a snapshot for a small spec', () => {
    expect(renderClientModule(minimalSpec())).toMatchSnapshot();
  });
});

describe('clientInputSchema', () => {
  it('adds a required confirm: true to destructive operations only', () => {
    const [operation] = minimalSpec().operations;
    const input = clientInputSchema(operation!);
    expect(input.required).toEqual(['project', 'widget', 'confirm']);
    expect(input.properties?.confirm?.const).toBe(true);
    expect(clientInputSchema({ ...operation!, destructive: false })).toBe(operation!.input);
  });

  it('covers every destructive operation in the real spec', () => {
    for (const operation of spec.operations.filter((o) => o.destructive)) {
      expect(clientInputSchema(operation).required).toContain('confirm');
    }
  });
});

describe('emitType', () => {
  it('maps scalars, nullables, enums and consts', () => {
    expect(emitType({ type: 'string' })).toBe('string');
    expect(emitType({ type: 'integer' })).toBe('number');
    expect(emitType({ type: ['string', 'null'] })).toBe('string | null');
    expect(emitType({ type: 'string', enum: ['a', 'b'] })).toBe('"a" | "b"');
    expect(emitType({ type: 'string', const: 'x' })).toBe('"x"');
    expect(emitType({ anyOf: [{ type: 'integer' }, { type: 'null' }] })).toBe('number | null');
    expect(emitType({})).toBe('unknown');
  });

  it('maps arrays, maps and objects', () => {
    expect(emitType({ type: 'array', items: { type: 'string' } })).toBe('Array<string>');
    expect(emitType({ type: 'object', propertyNames: { type: 'string' }, additionalProperties: {} })).toBe(
      'Record<string, unknown>',
    );
    expect(emitType({ type: 'object', additionalProperties: { type: 'number' } })).toBe('Record<string, number>');
    expect(emitType({ type: 'object', properties: {} })).toBe('Record<string, never>');
    expect(
      emitType({
        type: 'object',
        properties: { a: { type: 'string', description: 'The a.' }, 'b-c': { type: 'boolean' } },
        required: ['a'],
      }),
    ).toBe('{\n  /** The a. */\n  a: string;\n  "b-c"?: boolean;\n}');
  });
});

describe('assertSpec', () => {
  it('accepts the committed spec', () => {
    expect(() => assertSpec(spec)).not.toThrow();
  });

  it('rejects specs the client cannot represent', () => {
    expect(() => assertSpec({ kind: 'other' })).toThrow(/Not a hypequery Cloud operations spec/);
    expect(() => assertSpec(minimalSpec({ version: 2 }))).toThrow(/version 2/);
    const [operation] = minimalSpec().operations;
    expect(() =>
      assertSpec(minimalSpec({ operations: [{ ...operation!, http: { method: 'DELETE', path: '/w/{missing}' } }] })),
    ).toThrow(/\{missing\}/);
    expect(() => assertSpec(minimalSpec({ operations: [operation!, operation!] }))).toThrow(/twice/);
    expect(() => assertSpec(minimalSpec({ operations: [{ ...operation!, errors: ['NOPE'] }] }))).toThrow(/NOPE/);
    expect(() => assertSpec(minimalSpec({ operations: [{ ...operation!, name: 'call.it' }] }))).toThrow(/reserved/);
  });
});

describe('diffSpecs', () => {
  it('finds no drift between a spec and a reformatted copy of it', () => {
    const reverseKeys = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(reverseKeys)
        : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]))
          : value;
    const reordered = reverseKeys(spec) as OperationsSpec;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(spec));
    expect(isEmptyDiff(diffSpecs(spec, reordered))).toBe(true);
  });

  it('lists added, removed and changed operations and error codes', () => {
    const current = minimalSpec();
    const [operation] = current.operations;
    const next = minimalSpec({
      operations: [
        { ...operation!, summary: 'Delete a widget.' },
        { ...operation!, name: 'widgets.archive' },
      ],
      errors: { ...current.errors, GONE: { status: 410, category: 'correctable_input', retryable: false, hint: '', docsUrl: '' } },
    });
    const diff = diffSpecs(current, next);
    expect(diff).toMatchObject({ added: ['widgets.archive'], removed: [], changed: ['widgets.remove'], errors: ['GONE'] });
    expect(formatDiff(diff)).toContain('Added operations:\n  widgets.archive');
    expect(diffSpecs(next, current).removed).toEqual(['widgets.archive']);
  });

  it('counts a reorder of operations as drift', () => {
    const current = minimalSpec();
    const [operation] = current.operations;
    const a = minimalSpec({ operations: [operation!, { ...operation!, name: 'widgets.archive' }] });
    const b = minimalSpec({ operations: [{ ...operation!, name: 'widgets.archive' }, operation!] });
    expect(diffSpecs(a, b).changed).toEqual(['(operation order)']);
  });
});
