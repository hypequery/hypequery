import { describe, expect, it } from 'vitest';
import { describeParameterizedViewQuery, parseViewParameters } from './describe-relation.js';

describe('legacy parseViewParameters', () => {
  it('reads parameters in code only, keeping quoted text inside a type', () => {
    const sql = "CREATE VIEW v AS SELECT '{p:NotAType}' AS a /* {r:Bad} */ FROM t WHERE n > {p:UInt64} AND ts < {to:DateTime64(3, 'UTC')} -- {s:Bad}";
    expect(parseViewParameters(sql)).toEqual([
      { name: 'p', type: 'UInt64' },
      { name: 'to', type: "DateTime64(3, 'UTC')" },
    ]);
  });

  it('describes a call with type defaults', () => {
    expect(describeParameterizedViewQuery('pv', [{ name: 'app', type: 'String' }]))
      .toBe("DESCRIBE (SELECT * FROM `pv`(`app` = defaultValueOfTypeName('String')))");
  });
});
