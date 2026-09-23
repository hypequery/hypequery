/**
 * A trusted SQL expression must not be able to rebind the predicates beside it.
 *
 * A dataset dimension may be backed by SQL its author wrote during a build. The
 * semantic layer passes that expression into the column slot of a `where`, and
 * the tenant predicate is a separate `where` on the same query. Rendered bare,
 * an expression containing a top-level `OR` rebinds across the `AND` that joins
 * them, so the tenant predicate stops constraining the second branch and the
 * query returns rows belonging to every tenant.
 *
 * These are regression tests for that leak. They assert on rendered SQL rather
 * than on rows, because the defect is entirely one of operator precedence.
 */
import { setupUsersBuilder } from './test-utils.js';

describe('a trusted expression cannot widen a tenant predicate', () => {
  it('groups an OR-bearing filter column so the tenant predicate still binds', () => {
    const { sql } = setupUsersBuilder()
      .select(['id'])
      .where('tenant_id' as never, 'eq', 't1')
      .where('is_active OR 1 = 1' as never, 'eq', true)
      .toSQLWithParams();

    expect(sql).toContain('(is_active OR 1 = 1)');
    // The tenant predicate is ANDed with one grouped operand, so no branch of
    // the expression escapes it.
    expect(sql).not.toMatch(/AND is_active OR/);
  });

  it('keeps the grouping for every operator that takes a column', () => {
    const expression = 'is_active OR 1 = 1';
    for (const build of [
      () => setupUsersBuilder().where(expression as never, 'in', ['a', 'b'] as never),
      () => setupUsersBuilder().where(expression as never, 'like', '%a%' as never),
      () => setupUsersBuilder().where(expression as never, 'between', [1, 2] as never),
      () => setupUsersBuilder().where(expression as never, 'isNull', null as never),
      () => setupUsersBuilder().where(expression as never, 'gt', 1 as never),
    ]) {
      const { sql } = build().toSQLWithParams();
      expect(sql).toContain(`(${expression})`);
    }
  });

  it('terminates a trailing line comment so it cannot swallow the tenant predicate', () => {
    const { sql } = setupUsersBuilder()
      .select(['id'])
      .where('is_active -- note' as never, 'eq', true)
      .where('tenant_id' as never, 'eq', 't1')
      .toSQLWithParams();

    // Without the newline the comment runs to end of line, taking the tenant
    // predicate with it.
    expect(sql).toContain('is_active -- note\n');
    expect(sql).toContain('tenant_id');
    expect(sql.split('-- note')[1]).toContain('tenant_id');
  });

  it('leaves an ordinary column untouched', () => {
    const { sql } = setupUsersBuilder()
      .select(['id'])
      .where('tenant_id' as never, 'eq', 't1')
      .toSQLWithParams();

    expect(sql).toContain('tenant_id = ?');
    expect(sql).not.toContain('(tenant_id)');
  });
});
