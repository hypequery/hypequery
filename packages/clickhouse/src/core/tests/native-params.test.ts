import { describe, it, expect } from 'vitest';
import { inferClickHouseType } from '../utils/type-inference.js';
import { QueryBuilder } from '../query-builder.js';
import { ClickHouseDialect } from '../dialects/clickhouse-dialect.js';

describe('Type Inference', () => {
  it('should infer Int64 for integers', () => {
    expect(inferClickHouseType(42)).toBe('Int64');
    expect(inferClickHouseType(0)).toBe('Int64');
    expect(inferClickHouseType(-100)).toBe('Int64');
  });

  it('should infer Float64 for floats', () => {
    expect(inferClickHouseType(3.14)).toBe('Float64');
    expect(inferClickHouseType(-2.5)).toBe('Float64');
  });

  it('should infer Float64 for NaN and Infinity', () => {
    expect(inferClickHouseType(NaN)).toBe('Float64');
    expect(inferClickHouseType(Infinity)).toBe('Float64');
    expect(inferClickHouseType(-Infinity)).toBe('Float64');
  });

  it('should infer String for strings', () => {
    expect(inferClickHouseType('hello')).toBe('String');
    expect(inferClickHouseType('')).toBe('String');
  });

  it('should infer Bool for booleans', () => {
    expect(inferClickHouseType(true)).toBe('Bool');
    expect(inferClickHouseType(false)).toBe('Bool');
  });

  it('should infer DateTime for Date objects', () => {
    expect(inferClickHouseType(new Date())).toBe('DateTime');
  });

  it('should infer Nullable(String) for null and undefined', () => {
    expect(inferClickHouseType(null)).toBe('Nullable(String)');
    expect(inferClickHouseType(undefined)).toBe('Nullable(String)');
  });

  it('should infer Array types', () => {
    expect(inferClickHouseType([1, 2, 3])).toBe('Array(Int64)');
    expect(inferClickHouseType(['a', 'b'])).toBe('Array(String)');
    expect(inferClickHouseType([true, false])).toBe('Array(Bool)');
    expect(inferClickHouseType([])).toBe('Array(String)'); // Empty array defaults to String
  });

  it('should infer nested array types', () => {
    expect(inferClickHouseType([[1, 2], [3, 4]])).toBe('Array(Array(Int64))');
  });

  it('should infer String for objects (will be JSON stringified)', () => {
    expect(inferClickHouseType({ foo: 'bar' })).toBe('String');
    expect(inferClickHouseType({ nested: { value: 42 } })).toBe('String');
  });
});

describe('Native Parameter Binding - SQL Generation', () => {
  const dialect = new ClickHouseDialect();

  it('should generate typed placeholders for basic equality', () => {
    const qb = new QueryBuilder({ tableName: 'users' });
    const query = qb.where('id', 'eq', 42);
    const compiled = dialect.compileQuery(query.getQueryNode(), { tableName: 'users' });

    expect(compiled.query).toContain('{param_0:Int64}');
    expect(compiled.parameters).toEqual([42]);
  });

  it('should generate typed placeholders for strings', () => {
    const qb = new QueryBuilder({ tableName: 'users' });
    const query = qb.where('name', 'eq', 'Alice');
    const compiled = dialect.compileQuery(query.getQueryNode(), { tableName: 'users' });

    expect(compiled.query).toContain('{param_0:String}');
    expect(compiled.parameters).toEqual(['Alice']);
  });

  it('should generate typed placeholders for IN operator', () => {
    const qb = new QueryBuilder({ tableName: 'users' });
    const query = qb.where('id', 'in', [1, 2, 3]);
    const compiled = dialect.compileQuery(query.getQueryNode(), { tableName: 'users' });

    expect(compiled.query).toContain('{param_0:Int64}');
    expect(compiled.query).toContain('{param_1:Int64}');
    expect(compiled.query).toContain('{param_2:Int64}');
    expect(compiled.parameters).toEqual([1, 2, 3]);
  });

  it('should generate typed placeholders for BETWEEN operator', () => {
    const qb = new QueryBuilder({ tableName: 'users' });
    const query = qb.where('age', 'between', [18, 65]);
    const compiled = dialect.compileQuery(query.getQueryNode(), { tableName: 'users' });

    expect(compiled.query).toContain('BETWEEN {param_0:Int64} AND {param_1:Int64}');
    expect(compiled.parameters).toEqual([18, 65]);
  });

  it('should generate typed placeholders for LIKE operator', () => {
    const qb = new QueryBuilder({ tableName: 'users' });
    const query = qb.where('name', 'like', 'John%');
    const compiled = dialect.compileQuery(query.getQueryNode(), { tableName: 'users' });

    expect(compiled.query).toContain('LIKE {param_0:String}');
    expect(compiled.parameters).toEqual(['John%']);
  });

  it('should generate typed placeholders for multiple conditions', () => {
    const qb = new QueryBuilder({ tableName: 'users' });
    const query = qb
      .where('id', 'eq', 42)
      .where('status', 'eq', 'active')
      .where('age', 'gt', 18);
    const compiled = dialect.compileQuery(query.getQueryNode(), { tableName: 'users' });

    expect(compiled.query).toContain('{param_0:Int64}');
    expect(compiled.query).toContain('{param_1:String}');
    expect(compiled.query).toContain('{param_2:Int64}');
    expect(compiled.parameters).toEqual([42, 'active', 18]);
  });

  it('should handle boolean parameters', () => {
    const qb = new QueryBuilder({ tableName: 'users' });
    const query = qb.where('active', 'eq', true);
    const compiled = dialect.compileQuery(query.getQueryNode(), { tableName: 'users' });

    expect(compiled.query).toContain('{param_0:Bool}');
    expect(compiled.parameters).toEqual([true]);
  });

  it('should handle Date parameters', () => {
    const qb = new QueryBuilder({ tableName: 'events' });
    const date = new Date('2024-01-01T00:00:00Z');
    const query = qb.where('created_at', 'gt', date);
    const compiled = dialect.compileQuery(query.getQueryNode(), { tableName: 'events' });

    expect(compiled.query).toContain('{param_0:DateTime}');
    expect(compiled.parameters).toEqual([date]);
  });

  it('should reset parameter counter for each query', () => {
    const qb1 = new QueryBuilder({ tableName: 'users' });
    const query1 = qb1.where('id', 'eq', 1);
    const compiled1 = dialect.compileQuery(query1.getQueryNode(), { tableName: 'users' });

    const qb2 = new QueryBuilder({ tableName: 'users' });
    const query2 = qb2.where('id', 'eq', 2);
    const compiled2 = dialect.compileQuery(query2.getQueryNode(), { tableName: 'users' });

    // Both should start with param_0
    expect(compiled1.query).toContain('{param_0:Int64}');
    expect(compiled2.query).toContain('{param_0:Int64}');
  });
});

describe('Security - Native Params', () => {
  const dialect = new ClickHouseDialect();

  it('should safely handle trailing backslash in string value', () => {
    const qb = new QueryBuilder({ tableName: 'users' });
    const query = qb.where('value', 'eq', '\\');
    const compiled = dialect.compileQuery(query.getQueryNode(), { tableName: 'users' });

    // The backslash is passed as a parameter, not in the SQL string
    expect(compiled.query).toContain('{param_0:String}');
    expect(compiled.parameters).toEqual(['\\']);
    // No SQL injection possible - value is passed separately
  });

  it('should safely handle SQL injection attempts', () => {
    const qb = new QueryBuilder({ tableName: 'users' });
    const query = qb
      .where('value1', 'eq', '\\')
      .where('value2', 'eq', ' OR 1=1 -- ');
    const compiled = dialect.compileQuery(query.getQueryNode(), { tableName: 'users' });

    // Both values passed as parameters - no SQL injection possible
    expect(compiled.query).toContain('{param_0:String}');
    expect(compiled.query).toContain('{param_1:String}');
    expect(compiled.parameters).toEqual(['\\', ' OR 1=1 -- ']);
  });

  it('should safely handle quotes in string values', () => {
    const qb = new QueryBuilder({ tableName: 'users' });
    const query = qb.where('name', 'eq', "O'Reilly");
    const compiled = dialect.compileQuery(query.getQueryNode(), { tableName: 'users' });

    // Quote is passed as parameter, not in SQL
    expect(compiled.query).toContain('{param_0:String}');
    expect(compiled.parameters).toEqual(["O'Reilly"]);
  });

  it('should safely handle mixed special characters', () => {
    const qb = new QueryBuilder({ tableName: 'users' });
    const maliciousValue = "\\' OR 1=1 -- ";
    const query = qb.where('value', 'eq', maliciousValue);
    const compiled = dialect.compileQuery(query.getQueryNode(), { tableName: 'users' });

    // Entire value passed as parameter - completely safe
    expect(compiled.query).toContain('{param_0:String}');
    expect(compiled.parameters).toEqual([maliciousValue]);
  });
});

describe('Adapter - Parameter Map Building', () => {
  it('should extract parameter names from SQL', () => {
    const sql = 'SELECT * FROM users WHERE id = {param_0:Int64} AND name = {param_1:String}';
    const params = [42, 'Alice'];

    // Simulate what the adapter does
    const regex = /\{(\w+):[^}]+\}/g;
    const paramMap: Record<string, unknown> = {};
    let match;
    let index = 0;

    while ((match = regex.exec(sql)) !== null) {
      paramMap[match[1]] = params[index++];
    }

    expect(paramMap).toEqual({
      param_0: 42,
      param_1: 'Alice'
    });
  });

  it('should handle empty parameter list', () => {
    const sql = 'SELECT * FROM users';
    const params: unknown[] = [];

    const regex = /\{(\w+):[^}]+\}/g;
    const paramMap: Record<string, unknown> = {};
    let match;
    let index = 0;

    while ((match = regex.exec(sql)) !== null) {
      paramMap[match[1]] = params[index++];
    }

    expect(paramMap).toEqual({});
  });

  it('should handle IN clause with multiple parameters', () => {
    const sql = 'SELECT * FROM users WHERE id IN ({param_0:Int64}, {param_1:Int64}, {param_2:Int64})';
    const params = [1, 2, 3];

    const regex = /\{(\w+):[^}]+\}/g;
    const paramMap: Record<string, unknown> = {};
    let match;
    let index = 0;

    while ((match = regex.exec(sql)) !== null) {
      paramMap[match[1]] = params[index++];
    }

    expect(paramMap).toEqual({
      param_0: 1,
      param_1: 2,
      param_2: 3
    });
  });
});
