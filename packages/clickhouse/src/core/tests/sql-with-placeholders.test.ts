import { raw } from '../utils/sql-expressions.js';
import { substituteParameters } from '../utils.js';
import { setupTestBuilder } from './test-utils.js';

/** A Postgres-style numbering callback, recording what it was given. */
function numbering() {
  const values: unknown[] = [];
  return { values, placeholder: (value: unknown) => `$${values.push(value)}` };
}

describe('toSQLWithPlaceholders', () => {
  it('writes each bound value through the callback, in SQL order', () => {
    const { values, placeholder } = numbering();
    const sql = setupTestBuilder()
      .select(['name'])
      .where('category', 'eq', 'books')
      .where('price', 'between', [5, 10])
      .where('id', 'in', [1, 2, 3])
      .toSQLWithPlaceholders(placeholder);

    expect(sql).toBe('SELECT name FROM test_table WHERE category = $1 AND price BETWEEN $2 AND $3 AND id IN ($4, $5, $6)');
    expect(values).toEqual(['books', 5, 10, 1, 2, 3]);
  });

  it('numbers CTE values before the outer query, matching toSQLWithParams', () => {
    const builder = setupTestBuilder();
    const cte = builder.select(['id']).where('price', 'gt', 500);
    const query = builder.withCTE('expensive', cte).select(['name']).where('category', 'eq', 'books');
    const { values, placeholder } = numbering();

    const sql = query.toSQLWithPlaceholders(placeholder);
    const positional = query.toSQLWithParams();
    expect(values).toEqual(positional.parameters);
    expect(sql.replace(/\$\d+/g, '?')).toBe(positional.sql);
  });

  it('leaves question marks inside literals, identifiers and comments alone', () => {
    const { values, placeholder } = numbering();
    const sql = setupTestBuilder()
      .select([raw("'what?' AS q"), raw('`odd?col`'), raw('1 /* why? */ AS one')])
      .where('name', 'eq', 'a?b')
      .toSQLWithPlaceholders(placeholder);

    expect(sql).toContain("'what?' AS q");
    expect(sql).toContain('`odd?col`');
    expect(sql).toContain('/* why? */');
    expect(sql).toContain('name = $1');
    expect(values).toEqual(['a?b']);
  });

  it('reproduces toSQL when the callback inlines escaped values', () => {
    const query = setupTestBuilder().where('name', 'eq', "O'Brien").where('id', 'notIn', [4, 5]);
    const { parameters } = query.toSQLWithParams();
    let index = 0;
    const sql = query.toSQLWithPlaceholders(() => substituteParameters('?', [parameters[index++]]));
    expect(sql).toBe(query.toSQL());
  });

  it('calls nothing for a statement without values', () => {
    let calls = 0;
    expect(setupTestBuilder().select(['id']).toSQLWithPlaceholders(() => { calls++; return '?'; }))
      .toBe('SELECT id FROM test_table');
    expect(calls).toBe(0);
  });
});
