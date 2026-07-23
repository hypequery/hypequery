import {
  hasTopLevelLogicalOperator,
  isFullyParenthesized,
  terminateTrailingLineComment
} from '../utils/sql-parens.js';

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

  it('ignores comments while preserving operators that follow them', () => {
    expect(hasTopLevelLogicalOperator("a = 1 /* '([ OR hidden */ OR b = 2")).toBe(true);
    expect(hasTopLevelLogicalOperator("a = 1 -- '([ OR hidden\nOR b = 2")).toBe(true);
    expect(hasTopLevelLogicalOperator("a = 1 // '([ OR hidden\nAND b = 2")).toBe(true);
    expect(hasTopLevelLogicalOperator("a = 1 # '([ OR hidden\nAND b = 2")).toBe(true);
    expect(hasTopLevelLogicalOperator("a = 1 #! '([ OR hidden\nOR b = 2")).toBe(true);
  });

  it('ignores logical operators contained entirely in comments', () => {
    expect(hasTopLevelLogicalOperator('a = 1 /* OR b = 2 */')).toBe(false);
    expect(hasTopLevelLogicalOperator('a = 1 -- OR b = 2')).toBe(false);
    expect(hasTopLevelLogicalOperator('a = 1 // AND b = 2')).toBe(false);
    expect(hasTopLevelLogicalOperator('a = 1 # OR b = 2')).toBe(false);
  });

  it('handles nested block comments', () => {
    expect(hasTopLevelLogicalOperator('a = 1 /* outer /* OR */ ) */ OR b = 2')).toBe(true);
    expect(hasTopLevelLogicalOperator('a = 1 /* outer /* OR */ AND */')).toBe(false);
  });

  it('ignores heredoc contents', () => {
    expect(hasTopLevelLogicalOperator('value = $tag$) OR /* hidden$tag$')).toBe(false);
    expect(
      hasTopLevelLogicalOperator('position($tag$) OR /* hidden$tag$, text) > 0 OR fallback = 1')
    ).toBe(true);
  });

  it('ignores Unicode-quoted literal and identifier contents', () => {
    expect(hasTopLevelLogicalOperator('value = \u2018) OR /* hidden\u2019')).toBe(false);
    expect(
      hasTopLevelLogicalOperator('position(\u2018) OR /* hidden\u2019, text) > 0 OR fallback = 1')
    ).toBe(true);
    expect(hasTopLevelLogicalOperator('value = \u201c) AND hidden\u201d')).toBe(false);
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

describe('terminateTrailingLineComment', () => {
  it('terminates ClickHouse line comments before generated SQL is appended', () => {
    expect(terminateTrailingLineComment('a = 1 -- note')).toBe('a = 1 -- note\n');
    expect(terminateTrailingLineComment('a = 1 // note')).toBe('a = 1 // note\n');
    expect(terminateTrailingLineComment('a = 1 # note')).toBe('a = 1 # note\n');
    expect(terminateTrailingLineComment('a = 1 #! note')).toBe('a = 1 #! note\n');
  });

  it('does not alter terminated comments or comment markers in non-code regions', () => {
    expect(terminateTrailingLineComment('a = 1 -- note\n')).toBe('a = 1 -- note\n');
    expect(terminateTrailingLineComment("a = '-- not a comment'")).toBe("a = '-- not a comment'");
    expect(terminateTrailingLineComment('a = $tag$// not a comment$tag$')).toBe(
      'a = $tag$// not a comment$tag$'
    );
    expect(terminateTrailingLineComment('a = 1 /* -- not a line comment */')).toBe(
      'a = 1 /* -- not a line comment */'
    );
  });
});

describe('isFullyParenthesized', () => {
  it('accepts a single enclosing group', () => {
    expect(isFullyParenthesized('(a = 1)')).toBe(true);
    expect(isFullyParenthesized('((a) OR (b))')).toBe(true);
    expect(isFullyParenthesized("(name = ')')")).toBe(true);
    expect(isFullyParenthesized('(/* ) OR hidden */ a = 1)')).toBe(true);
    expect(isFullyParenthesized('(value = $tag$) OR hidden$tag$)')).toBe(true);
  });

  it('rejects fragments that are not one group', () => {
    expect(isFullyParenthesized('a = 1')).toBe(false);
    expect(isFullyParenthesized('(a) OR (b)')).toBe(false);
    expect(isFullyParenthesized('(a) OR (b) AND (c)')).toBe(false);
    expect(isFullyParenthesized('f(a)')).toBe(false);
    expect(isFullyParenthesized('(a]')).toBe(false);
  });
});
