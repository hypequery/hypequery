import { hasTopLevelLogicalOperator, isFullyParenthesized } from '../utils/sql-parens.js';

describe('hasTopLevelLogicalOperator', () => {
  it('detects bare AND/OR at the top level', () => {
    expect(hasTopLevelLogicalOperator("a = 1 OR b = 2")).toBe(true);
    expect(hasTopLevelLogicalOperator("a = 1 AND b = 2")).toBe(true);
    expect(hasTopLevelLogicalOperator("(a = 1) OR (b = 2)")).toBe(true);
    expect(hasTopLevelLogicalOperator("or x")).toBe(true);
    expect(hasTopLevelLogicalOperator("a and b")).toBe(true);
  });

  it('ignores AND/OR inside parentheses and brackets', () => {
    expect(hasTopLevelLogicalOperator("(a = 1 OR b = 2)")).toBe(false);
    expect(hasTopLevelLogicalOperator("if(a OR b, 1, 0) = 1")).toBe(false);
    expect(hasTopLevelLogicalOperator("arr[a OR b]")).toBe(false);
  });

  it('ignores AND/OR inside string literals and quoted identifiers', () => {
    expect(hasTopLevelLogicalOperator("name = 'a OR b'")).toBe(false);
    expect(hasTopLevelLogicalOperator("name = 'it''s AND more'")).toBe(false);
    expect(hasTopLevelLogicalOperator('`weird or column` = 1')).toBe(false);
    expect(hasTopLevelLogicalOperator('"and" = 1')).toBe(false);
  });

  it('does not match words containing and/or', () => {
    expect(hasTopLevelLogicalOperator('major = 1')).toBe(false);
    expect(hasTopLevelLogicalOperator('ORDER_ID = 1')).toBe(false);
    expect(hasTopLevelLogicalOperator('android = 1')).toBe(false);
    expect(hasTopLevelLogicalOperator('x = brand')).toBe(false);
  });

  it('handles unbalanced closers without going negative', () => {
    expect(hasTopLevelLogicalOperator(') OR a = 1')).toBe(true);
  });
});

describe('isFullyParenthesized', () => {
  it('accepts a single enclosing group', () => {
    expect(isFullyParenthesized('(a = 1)')).toBe(true);
    expect(isFullyParenthesized('((a) OR (b))')).toBe(true);
    expect(isFullyParenthesized("(name = ')')")).toBe(true);
  });

  it('rejects fragments that are not one group', () => {
    expect(isFullyParenthesized('a = 1')).toBe(false);
    expect(isFullyParenthesized('(a) OR (b)')).toBe(false);
    expect(isFullyParenthesized('(a) OR (b) AND (c)')).toBe(false);
    expect(isFullyParenthesized('f(a)')).toBe(false);
  });
});
