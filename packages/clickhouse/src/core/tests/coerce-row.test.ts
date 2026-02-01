import { coerceRows, clickHouseTypeToCoercion } from '../utils/coerce-row.js';

describe('clickHouseTypeToCoercion', () => {
  it('maps integer types to number', () => {
    expect(clickHouseTypeToCoercion('Int8')).toBe('number');
    expect(clickHouseTypeToCoercion('Int32')).toBe('number');
    expect(clickHouseTypeToCoercion('Int64')).toBe('number');
    expect(clickHouseTypeToCoercion('UInt8')).toBe('number');
    expect(clickHouseTypeToCoercion('UInt64')).toBe('number');
  });

  it('maps float types to number', () => {
    expect(clickHouseTypeToCoercion('Float32')).toBe('number');
    expect(clickHouseTypeToCoercion('Float64')).toBe('number');
  });

  it('maps decimal types to number', () => {
    expect(clickHouseTypeToCoercion('Decimal32')).toBe('number');
    expect(clickHouseTypeToCoercion('Decimal64')).toBe('number');
    expect(clickHouseTypeToCoercion('Decimal(18, 4)' as any)).toBe('number');
  });

  it('maps boolean types to boolean', () => {
    expect(clickHouseTypeToCoercion('Bool')).toBe('boolean');
    expect(clickHouseTypeToCoercion('Boolean')).toBe('boolean');
  });

  it('returns undefined for string types', () => {
    expect(clickHouseTypeToCoercion('String')).toBeUndefined();
    expect(clickHouseTypeToCoercion('UUID')).toBeUndefined();
  });

  it('returns undefined for date/time types', () => {
    expect(clickHouseTypeToCoercion('Date')).toBeUndefined();
    expect(clickHouseTypeToCoercion('DateTime')).toBeUndefined();
    expect(clickHouseTypeToCoercion('DateTime64(9)' as any)).toBeUndefined();
  });

  it('unwraps Nullable', () => {
    expect(clickHouseTypeToCoercion('Nullable(Int32)')).toBe('number');
    expect(clickHouseTypeToCoercion('Nullable(String)')).toBeUndefined();
    expect(clickHouseTypeToCoercion('Nullable(Float64)')).toBe('number');
  });

  it('unwraps LowCardinality', () => {
    expect(clickHouseTypeToCoercion('LowCardinality(String)')).toBeUndefined();
  });
});

describe('coerceRows', () => {
  it('returns rows unchanged when no outputColumns', () => {
    const rows = [{ a: '123', b: 'hello' }];
    const result = coerceRows(rows, undefined);
    expect(result).toBe(rows);
    expect(result[0].a).toBe('123');
  });

  it('returns rows unchanged when outputColumns is empty', () => {
    const rows = [{ a: '123' }];
    const result = coerceRows(rows, {});
    expect(result).toBe(rows);
  });

  it('coerces string values to numbers', () => {
    const rows = [
      { price_sum: '123.45', name: 'test' },
      { price_sum: '0', name: 'other' },
    ];
    coerceRows(rows, { price_sum: 'number' });
    expect(rows[0].price_sum).toBe(123.45);
    expect(rows[1].price_sum).toBe(0);
    expect(rows[0].name).toBe('test');
  });

  it('leaves numbers as numbers', () => {
    const rows = [{ count: 42 }];
    coerceRows(rows, { count: 'number' });
    expect(rows[0].count).toBe(42);
  });

  it('coerces boolean values', () => {
    const rows = [
      { active: 1 },
      { active: 0 },
      { active: '1' },
      { active: '0' },
      { active: 'true' },
      { active: 'false' },
      { active: true },
    ];
    coerceRows(rows, { active: 'boolean' });
    expect(rows[0].active).toBe(true);
    expect(rows[1].active).toBe(false);
    expect(rows[2].active).toBe(true);
    expect(rows[3].active).toBe(false);
    expect(rows[4].active).toBe(true);
    expect(rows[5].active).toBe(false);
    expect(rows[6].active).toBe(true);
  });

  it('handles null values gracefully', () => {
    const rows = [{ amount: null }];
    coerceRows(rows, { amount: 'number' });
    expect(rows[0].amount).toBeNull();
  });

  it('handles undefined values gracefully', () => {
    const rows = [{ amount: undefined }];
    coerceRows(rows, { amount: 'number' });
    expect(rows[0].amount).toBeUndefined();
  });

  it('preserves non-numeric strings when coercing to number', () => {
    const rows = [{ val: 'not-a-number' }];
    coerceRows(rows, { val: 'number' });
    expect(rows[0].val).toBe('not-a-number');
  });

  it('only coerces columns that exist in outputColumns', () => {
    const rows = [{ a: '123', b: '456' }];
    coerceRows(rows, { a: 'number' });
    expect(rows[0].a).toBe(123);
    expect(rows[0].b).toBe('456'); // untouched
  });

  it('handles multiple coercion types in same row', () => {
    const rows = [{ price: '99.99', active: 1, name: 'test' }];
    coerceRows(rows, { price: 'number', active: 'boolean' });
    expect(rows[0].price).toBe(99.99);
    expect(rows[0].active).toBe(true);
    expect(rows[0].name).toBe('test');
  });

  it('handles empty rows array', () => {
    const rows: any[] = [];
    const result = coerceRows(rows, { a: 'number' });
    expect(result).toEqual([]);
  });

  it('skips columns not present in the row', () => {
    const rows = [{ a: '1' }];
    coerceRows(rows, { a: 'number', nonexistent: 'number' });
    expect(rows[0].a).toBe(1);
  });
});
