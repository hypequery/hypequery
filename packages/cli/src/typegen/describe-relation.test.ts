import { describe, expect, it } from 'vitest';
import { describeParameterizedViewQuery, parseViewParameters } from './describe-relation.js';

describe('parseViewParameters', () => {
  it('reads each {name:Type} parameter once, in order', () => {
    const sql = "CREATE VIEW db.v AS SELECT * FROM t WHERE day >= {from:Date} AND app IN {apps: Array(String)} AND ts < {to:DateTime64(3, 'UTC')} AND day <= {from:Date}";
    expect(parseViewParameters(sql)).toEqual([
      { name: 'from', type: 'Date' },
      { name: 'apps', type: 'Array(String)' },
      { name: 'to', type: "DateTime64(3, 'UTC')" },
    ]);
  });

  it('ignores placeholder-shaped text in literals and comments', () => {
    const sql = "CREATE VIEW db.v AS SELECT '{p:NotAType}' AS label, `{q:Bad}` AS c /* {r:Bad} */ FROM t WHERE n > {p:UInt64} -- {s:Bad}\n AND x = $$ {t:Bad} $$";
    expect(parseViewParameters(sql)).toEqual([{ name: 'p', type: 'UInt64' }]);
  });

  it('returns nothing for a view without parameters', () => {
    expect(parseViewParameters('CREATE VIEW db.v AS SELECT 1')).toEqual([]);
  });
});

describe('describeParameterizedViewQuery', () => {
  it('calls the view with each type default, quoting names and types', () => {
    expect(describeParameterizedViewQuery('pv', [
      { name: 'from', type: 'Date' },
      { name: 'to', type: "DateTime64(3, 'UTC')" },
    ])).toBe(
      "DESCRIBE (SELECT * FROM `pv`(`from` = defaultValueOfTypeName('Date'), `to` = defaultValueOfTypeName('DateTime64(3, \\'UTC\\')')))"
    );
  });
});
