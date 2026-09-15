import { bindNamedParameters } from '../utils/named-parameters.js';

describe('bindNamedParameters', () => {
  it('rewrites placeholders to positional markers in order', () => {
    const bound = bindNamedParameters(
      'SELECT * FROM t WHERE a = {second:UInt8} AND b = {first:String}',
      { first: 'x', second: 2 },
    );

    expect(bound.sql).toBe(
      "SELECT * FROM t WHERE a = CAST(?, 'UInt8') AND b = CAST(?, 'String')"
    );
    expect(bound.parameters).toEqual([2, 'x']);
  });

  it('binds a repeated placeholder once per occurrence', () => {
    const bound = bindNamedParameters('SELECT {id:UInt8}, {id:UInt8}', { id: 3 });

    expect(bound.sql).toBe("SELECT CAST(?, 'UInt8'), CAST(?, 'UInt8')");
    expect(bound.parameters).toEqual([3, 3]);
  });

  it('reads types that contain parentheses and commas', () => {
    const bound = bindNamedParameters('SELECT has({ids:Array(UInt64)}, 1)', { ids: [1, 2] });

    expect(bound.sql).toBe("SELECT has(CAST(?, 'Array(UInt64)'), 1)");
    expect(bound.parameters).toEqual(['[1,2]']);
  });

  it('serializes nested arrays, nullable elements, and big integers without JSON', () => {
    const bound = bindNamedParameters(
      'SELECT {names:Array(Array(Nullable(String)))}, {ids:Array(UInt64)}, {empty:Array(String)}',
      { names: [["O'Brien", null], ['a\\b']], ids: [9007199254740993n], empty: [] },
    );

    expect(bound.parameters).toEqual(["[['O''Brien',NULL],['a\\\\b']]", '[9007199254740993]', '[]']);
  });

  it.each([
    "Enum8(')' = 1)",
    "Enum8('{' = 1)",
    "Enum8('}' = 1)",
    "Enum8('it''s(' = 1)",
    "Enum8('it\\'s)' = 1)",
    'Tuple(`column)` String)',
  ])('ignores quoted delimiters in %s', type => {
    const bound = bindNamedParameters(`SELECT {value:${type}}, {next:UInt8}`, { value: 'x', next: 2 });

    expect(bound.sql).toContain("CAST(?, 'UInt8')");
    expect(bound.sql).not.toContain('{value:');
    expect(bound.parameters).toEqual(['x', 2]);
  });

  it('leaves placeholders inside literals and comments alone', () => {
    const bound = bindNamedParameters(
      "SELECT '{id:UInt8}' AS literal -- {id:UInt8}\n, {id:UInt8} AS bound",
      { id: 1 },
    );

    expect(bound.sql).toBe(
      "SELECT '{id:UInt8}' AS literal -- {id:UInt8}\n, CAST(?, 'UInt8') AS bound"
    );
    expect(bound.parameters).toEqual([1]);
  });

  it('leaves braces that are not placeholders alone', () => {
    const bound = bindNamedParameters("SELECT * FROM cluster('{shard}', t)", {});

    expect(bound.sql).toBe("SELECT * FROM cluster('{shard}', t)");
    expect(bound.parameters).toEqual([]);
  });

  it('escapes quotes inside the declared type', () => {
    const bound = bindNamedParameters("SELECT {ts:DateTime('UTC')}", { ts: '2026-01-01 10:00:00' });

    expect(bound.sql).toBe("SELECT CAST(?, 'DateTime(''UTC'')')");
  });

  it('ignores values no placeholder references', () => {
    const bound = bindNamedParameters('SELECT {a:UInt8}', { a: 1, unused: 2 });

    expect(bound.parameters).toEqual([1]);
  });

  it('throws when a placeholder has no value', () => {
    expect(() => bindNamedParameters('SELECT {missing:UInt8}', { other: 1 })).toThrow(
      'SQL references parameter "missing", but no value was provided for it.'
    );
  });

  it('points at the missing type when a provided value is referenced without one', () => {
    expect(() => bindNamedParameters('SELECT {id}', { id: 1 })).toThrow(
      'SQL placeholder "{id}" is missing a type. Write it as {id:Type}, for example {id:UUID}.'
    );
  });
});
