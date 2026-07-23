// @ts-nocheck
/**
 * Execution-level regression guard for issue #348: an `expr.or([...])` group
 * combined with a scoping `.where(col, op, val)` must bind as a single unit so
 * the scope predicate constrains every OR branch. This runs the query against a
 * real ClickHouse and asserts no row escapes the scope column — the ground-truth
 * form of the data-isolation guarantee that the unit tests check as a string.
 */
import {
  initializeTestConnection,
  setupTestDatabase,
} from './setup';
import { SKIP_INTEGRATION_TESTS, SETUP_TIMEOUT } from './test-config.js';

describe('Integration Tests - WHERE precedence (issue #348)', () => {
  (SKIP_INTEGRATION_TESTS ? describe.skip : describe)('ClickHouse Integration', () => {
    let db: Awaited<ReturnType<typeof initializeTestConnection>>;

    beforeAll(async () => {
      if (!SKIP_INTEGRATION_TESTS) {
        db = await initializeTestConnection();
        await setupTestDatabase();
      }
    }, SETUP_TIMEOUT);

    // Scope on `category` (a stand-in for a tenant/authorization column). The OR
    // group matches one in-scope row (Product A, category A) and one OUT-of-scope
    // row (Product E, category B). With correct parenthesization the out-of-scope
    // row is excluded; the pre-fix flat SQL would leak it via the second branch.
    test('an expr.or group does not let an OR branch escape the scope filter', async () => {
      const rows = await db.table('test_table')
        .select(['id', 'category', 'name'])
        .where('category', 'eq', 'A')
        .where(expr =>
          expr.or([
            expr.raw("positionCaseInsensitive(name, 'product a') > 0"),
            expr.raw("positionCaseInsensitive(name, 'product e') > 0"),
          ])
        )
        .execute();

      // Every returned row stays within the scope.
      expect(rows.every(row => String(row.category) === 'A')).toBe(true);
      // The in-scope match is present; the out-of-scope (category B) row is not.
      const ids = rows.map(row => Number(row.id)).sort((a, b) => a - b);
      expect(ids).toContain(1);
      expect(ids).not.toContain(5);
    });

    // Same guarantee when the OR group is added before the scope condition, so
    // the scope arrives as a later AND term in the sequence. Here the FIRST OR
    // branch matches an out-of-scope row (Product B, category B); the buggy flat
    // form `(b) OR (a) AND category = 'A'` would surface it.
    test('the scope filter still binds when added after the expr.or group', async () => {
      const rows = await db.table('test_table')
        .select(['id', 'category', 'name'])
        .where(expr =>
          expr.or([
            expr.raw("positionCaseInsensitive(name, 'product b') > 0"),
            expr.raw("positionCaseInsensitive(name, 'product a') > 0"),
          ])
        )
        .where('category', 'eq', 'A')
        .execute();

      expect(rows.every(row => String(row.category) === 'A')).toBe(true);
      const ids = rows.map(row => Number(row.id)).sort((a, b) => a - b);
      expect(ids).toEqual([1]);
    });
  });
});
