import { describe, expect, it } from 'vitest';
import { isAggregateOrWindowExpression } from './aggregate-detection.js';

describe('isAggregateOrWindowExpression', () => {
  it.each([
    'sum(points)',
    'round(avg(price), 2)',
    'sum(a) / count()',
    'countIf(status = 1)',
    'uniqExactIf(user_id, active)',
    'uniqMerge(users)',
    'sumState(bytes)',
    'quantileTDigest(0.95)(latency)',
    'topK(10)(page)',
    'rank() OVER (ORDER BY sum(points) DESC)',
    'row_number() OVER (PARTITION BY region ORDER BY ts)',
    'sum(x) OVER w',
  ])('treats %s as aggregate or window', expression => {
    expect(isAggregateOrWindowExpression(expression)).toBe(true);
  });

  it.each([
    'toDate(created_at)',
    'multiIf(score >= 90, \'A\', \'B\')',
    'concat(first_name, \' \', last_name)',
    "if(status = 'sum(x)', 1, 0)",
    'least(a, b)',
    'toStartOfInterval(ts, INTERVAL 1 HOUR)',
    'summary_count',
    'discount(price)',
  ])('treats %s as a plain expression', expression => {
    expect(isAggregateOrWindowExpression(expression)).toBe(false);
  });
});
