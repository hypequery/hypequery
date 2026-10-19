import { describe, expect, it } from 'vitest';
import { extractGroupByExpressions } from '../utils/derived-cte-validation.js';

describe('extractGroupByExpressions', () => {
  it('stops at the clause that follows GROUP BY', () => {
    expect(extractGroupByExpressions('SELECT a, b FROM t GROUP BY a, b HAVING count() > 1 ORDER BY a LIMIT 5'))
      .toEqual(['a', 'b']);
    expect(extractGroupByExpressions('SELECT a FROM t GROUP BY a')).toEqual(['a']);
    expect(extractGroupByExpressions('SELECT count() FROM t')).toEqual([]);
  });

  it('keeps quoted clause keywords and literals inside one term', () => {
    expect(extractGroupByExpressions('SELECT 1 FROM t GROUP BY `limit`, "offset", `having` LIMIT 10'))
      .toEqual(['`limit`', '"offset"', '`having`']);
    expect(extractGroupByExpressions("SELECT 1 FROM t GROUP BY concat(a, ', LIMIT '), `a``b` ORDER BY 1"))
      .toEqual(["concat(a, ', LIMIT ')", '`a``b`']);
  });

  it('ignores GROUP BY inside subqueries and keywords inside longer names', () => {
    expect(extractGroupByExpressions('SELECT x FROM (SELECT x FROM t GROUP BY x) s GROUP BY x, limit_value'))
      .toEqual(['x', 'limit_value']);
  });
});
