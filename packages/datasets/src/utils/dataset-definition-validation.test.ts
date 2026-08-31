import { describe, it, expect } from 'vitest';
import { dataset } from '../dataset.js';
import { dimension } from '../field.js';
import { measure } from '../measure.js';

const baseDimensions = {
  id: dimension.string(),
  amount: dimension.number(),
};

/** A definition that differs from a valid one only in the field under test. */
function defineWith(overrides: Record<string, unknown>) {
  return () =>
    dataset('orders', {
      source: 'orders',
      dimensions: baseDimensions,
      ...overrides,
    } as never);
}

describe('dataset definition validation', () => {
  describe('accepts valid definitions', () => {
    it('builds a minimal dataset', () => {
      expect(defineWith({})).not.toThrow();
    });

    it('accepts a database-qualified source', () => {
      expect(defineWith({ source: 'analytics.orders' })).not.toThrow();
    });

    it('accepts a tenantKey that is not exposed as a dimension', () => {
      expect(defineWith({ tenantKey: 'tenant_id' })).not.toThrow();
    });

    it('accepts a timeKey naming a physical column', () => {
      expect(defineWith({ timeKey: 'created_at' })).not.toThrow();
    });

    it('accepts a timeKey naming a declared dimension', () => {
      expect(
        defineWith({
          dimensions: { ...baseDimensions, createdAt: dimension.timestamp({ column: 'created_at' }) },
          timeKey: 'createdAt',
        }),
      ).not.toThrow();
    });

    it('accepts a measure over a hidden physical column', () => {
      expect(
        defineWith({ measures: { hiddenTotal: measure.sum('internal_amount') } }),
      ).not.toThrow();
    });

    it('accepts a raw sql expression whose dependencies it references', () => {
      expect(
        defineWith({
          dimensions: {
            ...baseDimensions,
            net: dimension.number({
              sql: 'amount - discount',
              dependencies: ['orders.amount', 'orders.discount'],
            }),
          },
        }),
      ).not.toThrow();
    });
  });

  describe('dataset name and source', () => {
    it('rejects an empty name', () => {
      expect(() => dataset('', { source: 'orders', dimensions: baseDimensions })).toThrow(
        /non-empty dataset name/,
      );
    });

    it('rejects a name that is not a safe identifier', () => {
      expect(() => dataset('orders-v2', { source: 'orders', dimensions: baseDimensions })).toThrow(
        /dataset names must contain only letters/,
      );
    });

    it('rejects an empty source', () => {
      expect(defineWith({ source: '' })).toThrow(/non-empty source table/);
    });

    it('rejects a source carrying injected SQL', () => {
      expect(defineWith({ source: 'orders; DROP TABLE users' })).toThrow(
        /not a safe table identifier/,
      );
    });

    it('rejects a source qualified more deeply than database.table', () => {
      expect(defineWith({ source: 'cluster.analytics.orders' })).toThrow(
        /not a safe table identifier/,
      );
    });
  });

  describe('tenant and time keys', () => {
    it('rejects an empty tenantKey rather than treating it as absent', () => {
      expect(defineWith({ tenantKey: '' })).toThrow(/tenantKey cannot be empty/);
    });

    it('rejects a tenantKey that is not a safe column identifier', () => {
      expect(defineWith({ tenantKey: 'tenant_id OR 1=1' })).toThrow(
        /tenantKey "tenant_id OR 1=1" is not a safe column identifier/,
      );
    });

    it('rejects an empty timeKey', () => {
      expect(defineWith({ timeKey: '' })).toThrow(/timeKey cannot be empty/);
    });

    it('rejects an unsafe timeKey', () => {
      expect(defineWith({ timeKey: 'created_at)' })).toThrow(/not a safe column identifier/);
    });
  });

  describe('dimensions', () => {
    it('rejects a dimension name containing a dot', () => {
      expect(
        defineWith({ dimensions: { ...baseDimensions, 'customer.name': dimension.string() } }),
      ).toThrow(/cannot contain "\."/);
    });

    it('rejects an unsafe backing column', () => {
      expect(
        defineWith({ dimensions: { ...baseDimensions, region: dimension.string({ column: 'a b' }) } }),
      ).toThrow(/dimension "region" column "a b" is not a safe column identifier/);
    });
  });

  describe('raw sql expressions', () => {
    it('rejects a statement terminator', () => {
      expect(
        defineWith({
          dimensions: { ...baseDimensions, evil: dimension.string({ sql: 'name; DROP TABLE users' }) },
        }),
      ).toThrow(/must be a single expression without statement terminators/);
    });

    it('rejects a line comment', () => {
      expect(
        defineWith({
          dimensions: { ...baseDimensions, evil: dimension.string({ sql: 'name -- rest' }) },
        }),
      ).toThrow(/must be a single expression without statement terminators/);
    });

    it('rejects a block comment', () => {
      expect(
        defineWith({
          dimensions: { ...baseDimensions, evil: dimension.string({ sql: 'name /* rest' }) },
        }),
      ).toThrow(/must be a single expression without statement terminators/);
    });

    it('rejects an empty sql expression', () => {
      expect(
        defineWith({ dimensions: { ...baseDimensions, blank: dimension.string({ sql: '   ' }) } }),
      ).toThrow(/declares an empty sql expression/);
    });

    it('rejects a declared dependency the expression never references', () => {
      expect(
        defineWith({
          dimensions: {
            ...baseDimensions,
            net: dimension.number({
              sql: 'amount - discount',
              dependencies: ['orders.amount', 'orders.tax'],
            }),
          },
        }),
      ).toThrow(/declares dependency "orders\.tax", but its sql expression never references it/);
    });

    it('does not treat a substring as a reference', () => {
      expect(
        defineWith({
          dimensions: {
            ...baseDimensions,
            net: dimension.number({ sql: 'amount_net', dependencies: ['orders.amount'] }),
          },
        }),
      ).toThrow(/never references it/);
    });

    it('accepts a terminator inside a quoted literal', () => {
      expect(
        defineWith({
          dimensions: { ...baseDimensions, tag: dimension.string({ sql: "concat(name, '; ')" }) },
        }),
      ).not.toThrow();
    });

    it('accepts a comment opener inside a quoted literal', () => {
      expect(
        defineWith({
          dimensions: {
            ...baseDimensions,
            clean: dimension.string({ sql: "replaceAll(note, '--', '')" }),
          },
        }),
      ).not.toThrow();
    });

    it('handles a doubled-quote escape inside a literal', () => {
      expect(
        defineWith({
          dimensions: { ...baseDimensions, tag: dimension.string({ sql: "concat(a, 'it''s;')" }) },
        }),
      ).not.toThrow();
    });

    it('rejects an unterminated literal rather than treating the rest as data', () => {
      expect(
        defineWith({
          dimensions: { ...baseDimensions, evil: dimension.string({ sql: "name' ; DROP TABLE t" }) },
        }),
      ).toThrow(/unterminated quoted literal/);
    });

    it('does not count a dependency that appears only inside a literal', () => {
      expect(
        defineWith({
          dimensions: {
            ...baseDimensions,
            label: dimension.string({ sql: "'amount'", dependencies: ['orders.amount'] }),
          },
        }),
      ).toThrow(/never references it/);
    });

    it('reports a dependency carrying regex syntax instead of throwing a SyntaxError', () => {
      expect(
        defineWith({
          dimensions: {
            ...baseDimensions,
            net: dimension.number({ sql: 'amount', dependencies: ['orders.amount('] }),
          },
        }),
      ).toThrow(/declares dependency "orders\.amount\(", but its sql expression never references it/);
    });

    it('does not let regex metacharacters in a dependency match something else', () => {
      // "a+" would match "aaa" if the value reached the pattern unescaped.
      expect(
        defineWith({
          dimensions: {
            ...baseDimensions,
            net: dimension.number({ sql: 'aaa', dependencies: ['orders.a+'] }),
          },
        }),
      ).toThrow(/never references it/);
    });

    it('applies the same checks to measures', () => {
      expect(
        defineWith({
          measures: { evil: measure.sum('amount', { sql: 'sum(amount); DROP TABLE users' }) },
        }),
      ).toThrow(/measure "evil" sql must be a single expression/);
    });
  });

  describe('measures', () => {
    it('rejects an unsafe field', () => {
      expect(defineWith({ measures: { total: measure.sum('amount)') } })).toThrow(
        /measure "total" field "amount\)" is not a safe column identifier/,
      );
    });

    it('rejects an unsafe argField', () => {
      expect(
        defineWith({ measures: { latest: measure.argMax('amount', 'created_at)') } }),
      ).toThrow(/measure "latest" argField "created_at\)" is not a safe column identifier/);
    });
  });

  describe('semantic names', () => {
    it('rejects a dimension name that is not a safe identifier', () => {
      expect(
        defineWith({ dimensions: { ...baseDimensions, 'bad-name': dimension.string() } }),
      ).toThrow(/dimension name "bad-name" must contain only letters/);
    });

    it('rejects a bad dimension name even when an explicit column stands in for it', () => {
      expect(
        defineWith({
          dimensions: { ...baseDimensions, 'bad-name': dimension.string({ column: 'good_col' }) },
        }),
      ).toThrow(/dimension name "bad-name" must contain only letters/);
    });

    it('rejects a measure name that is not a safe identifier', () => {
      expect(defineWith({ measures: { 'bad-name': measure.sum('amount') } })).toThrow(
        /measure name "bad-name" must contain only letters/,
      );
    });
  });

  describe('limits', () => {
    it('rejects a non-positive limit', () => {
      expect(defineWith({ limits: { maxResultSize: 0 } })).toThrow(
        /limits\.maxResultSize must be a positive integer/,
      );
    });

    it('rejects a fractional limit', () => {
      expect(defineWith({ limits: { maxDimensions: 2.5 } })).toThrow(
        /limits\.maxDimensions must be a positive integer/,
      );
    });
  });
});
