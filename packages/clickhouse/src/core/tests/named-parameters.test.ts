import { bindNamedParameters } from '../utils/named-parameters.js';
import { substituteParameters } from '../utils.js';

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
    ['Array(Tuple(UInt32, String))', [[1, 'x']], "[(1,'x')]"],
    ['Array(Array(UInt32))', [[1, 2]], '[[1,2]]'],
    ['Tuple(UInt32, Array(String))', [1, ['x']], "(1,['x'])"],
    ['Array(Map(String, UInt32))', [{ x: 1 }], "[{'x':1}]"],
    ['Array(Map(UInt64, Tuple(String, Nullable(UInt8))))', [new Map([[9007199254740993n, ['x', null]]])], "[{9007199254740993:('x',NULL)}]"],
    ['Array(Map(UInt32, UInt8))', [{ '1': 2 }], '[{1:2}]'],
    ['Array(Tuple(id UInt32, label String))', [{ label: 'x', id: 1 }], "[(1,'x')]"],
    ['Array(Tuple(`label,)` String, `id` UInt32))', [{ 'label,)': "O'Brien", id: 1 }], "[('O''Brien',1)]"],
    ["Array(Tuple(Enum8('a,b)' = 1), UInt8))", [['a,b)', 2]], "[('a,b)',2)]"],
    ['Array(Tuple(UInt64, Array(Nullable(String))))', [['9007199254740993', [null, 'x']]], "[(9007199254740993,[NULL,'x'])]"],
    ['Array(LowCardinality(String))', ['x'], "['x']"],
    ['Array(Tuple(UInt8))', [], '[]'],
  ])('serializes %s using its declared element types', (type, value, expected) => {
    const bound = bindNamedParameters(`SELECT {value:${type}}, {next:UInt8}`, { value, next: 2 });
    expect(bound.parameters).toEqual([expected, 2]);
  });

  it.each([
    ['Array(Tuple(UInt8, String))', [[1]]],
    ['Array(Tuple(UInt8, String))', [[1, 'x', 2]]],
    ['Array(Tuple(id UInt8, label String))', [{ id: 1 }]],
    ['Array(Map(String, UInt8))', [['x', 1]]],
    ['Array(Point)', [[1, 2]]],
    ['Array(UInt8)', [null]],
    ['Array(String)', [undefined]],
    ['Array(UInt8)', new Array(1)],
    ['Array(UInt64)', ["1); SELECT 2 --"]],
  ])('rejects unsupported or mismatched values for %s before execution', (type, value) => {
    expect(() => bindNamedParameters(`SELECT {value:${type}}`, { value })).toThrow('Cannot serialize parameter value as');
  });

  it('keeps pre-serialized compound parameters bound as strings', () => {
    const text = "[(1,'x')]";
    expect(bindNamedParameters('SELECT {value:Array(Tuple(UInt8, String))}', { value: text }).parameters).toEqual([text]);
  });

  it.each(['JSON', 'JSON(max_dynamic_paths=0)'])('keeps %s objects on the normal parameter escaping path', type => {
    const payload = { label: "O'Brien", path: 'a\\b', nested: { values: [1, true, null] } };
    const bound = bindNamedParameters(`SELECT {payload:${type}}, {next:UInt8}`, { payload, next: 2 });

    expect(bound.parameters).toEqual([payload, 2]);
    const rendered = substituteParameters(bound.sql, bound.parameters);
    expect(rendered).toContain("O''Brien");
    expect(rendered).toContain('"nested":{"values":[1,true,null]}');
    expect(rendered).toContain("CAST(2, 'UInt8')");
  });

  it('quotes JSON elements inside compound parameter text', () => {
    const payload = { label: "O'Brien", path: 'a\\b' };
    const bound = bindNamedParameters(
      'SELECT {values:Array(JSON)}, {tuple:Tuple(UInt8, JSON)}',
      { values: [payload], tuple: [1, payload] },
    );
    expect(bound.parameters).toEqual([
      "['{\"label\":\"O''Brien\",\"path\":\"a\\\\\\\\b\"}']",
      "(1,'{\"label\":\"O''Brien\",\"path\":\"a\\\\\\\\b\"}')",
    ]);
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
