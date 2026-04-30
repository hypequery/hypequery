import { describe, expect, it, vi } from 'vitest';
import { JoinRelationships, type JoinPath } from '../join-relationships.js';
import { normalizeFilterApplication } from '../utils/filter-application.js';
import { applyRelationPath, resolveRelationPath } from '../utils/relation-application.js';
import { validateRelationAliasOverride, validateRelationPathOrigin } from '../utils/relation-validation.js';
import { validateTupleFilterValue } from '../utils/tuple-filter-validation.js';
import { createSelectQueryNode } from '../query-node.js';

type TestSchema = {
  test_table: {
    id: 'Int32';
    created_by: 'Int32';
    updated_by: 'Int32';
  };
  users: {
    id: 'Int32';
    user_name: 'String';
  };
};

describe('Query Builder Helper Utilities', () => {
  describe('normalizeFilterApplication', () => {
    it('normalizes expression callbacks', () => {
      const expression = { sql: 'id = ?', parameters: [1] };
      const buildExpression = vi.fn(() => expression);

      const result = normalizeFilterApplication(
        'where',
        'AND',
        () => expression as any,
        undefined,
        undefined,
        buildExpression,
      );

      expect(result).toEqual({
        kind: 'expression',
        expression,
      });
      expect(buildExpression).toHaveBeenCalledOnce();
    });

    it('normalizes tuple conditions for multiple columns', () => {
      const result = normalizeFilterApplication(
        'where',
        'AND',
        ['id', 'created_by'],
        'inTuple',
        [[1, 2]],
        () => {
          throw new Error('should not build expression');
        },
      );

      expect(result).toEqual({
        kind: 'condition',
        column: ['id', 'created_by'],
        validationTarget: ['id', 'created_by'],
        operator: 'inTuple',
        value: [[1, 2]],
      });
    });

    it('throws when an operator is omitted for a column condition', () => {
      expect(() => {
        normalizeFilterApplication(
          'prewhere',
          'OR',
          'id',
          undefined,
          1,
          () => {
            throw new Error('should not build expression');
          },
        );
      }).toThrow('Operator is required when specifying a column for orPrewhere()');
    });
  });

  describe('validateTupleFilterValue', () => {
    it('allows non-tuple operators without tuple validation', () => {
      expect(() => {
        validateTupleFilterValue('eq', 'not-an-array', 1);
      }).not.toThrow();
    });

    it('throws for tuple width mismatches', () => {
      expect(() => {
        validateTupleFilterValue('inTuple', [[1, 2], [3]], 1);
      }).toThrow('Expected tuple 1 for inTuple operator to have 1 value, but got 2');
    });
  });

  describe('resolveRelationPath', () => {
    it('resolves named relationships from the registry', () => {
      const relationships = new JoinRelationships<TestSchema>();
      relationships.define('testToUsers', {
        from: 'test_table',
        to: 'users',
        leftColumn: 'created_by',
        rightColumn: 'id',
      });

      const result = resolveRelationPath('testToUsers', relationships);

      expect(result.label).toBe('testToUsers');
      expect(result.path).toEqual({
        from: 'test_table',
        to: 'users',
        leftColumn: 'created_by',
        rightColumn: 'id',
      });
    });

    it('passes direct paths through unchanged', () => {
      const directPath = {
        from: 'test_table',
        to: 'users',
        leftColumn: 'created_by',
        rightColumn: 'id',
      } as const satisfies JoinPath<TestSchema>;

      const result = resolveRelationPath(directPath, undefined);
      expect(result).toEqual({ path: directPath });
    });
  });

  describe('relation validation and application', () => {
    const baseQuery = createSelectQueryNode<any, TestSchema>({
      from: { kind: 'table', name: 'test_table' },
    });

    it('rejects alias override on chains', () => {
      const chain: readonly JoinPath<TestSchema>[] = [
        {
          from: 'test_table',
          to: 'users',
          leftColumn: 'created_by',
          rightColumn: 'id',
        },
        {
          from: 'users',
          to: 'test_table',
          leftColumn: 'id',
          rightColumn: 'updated_by',
        },
      ];

      expect(() => {
        validateRelationAliasOverride(chain, 'customer', 'chain');
      }).toThrow(
        "Join relationship 'chain' is a chain; alias override is only supported for single-join relationships"
      );
    });

    it('validates that chained relations start from available sources', () => {
      const chain: readonly JoinPath<TestSchema>[] = [
        {
          from: 'test_table',
          to: 'users',
          leftColumn: 'created_by',
          rightColumn: 'id',
          alias: 'creator',
        },
        {
          from: 'users',
          to: 'test_table',
          leftColumn: 'id',
          rightColumn: 'updated_by',
        },
      ];

      expect(() => {
        validateRelationPathOrigin(baseQuery, chain, 'brokenChain');
      }).toThrow(
        "Join relationship 'brokenChain' step 2 expects source 'users', but available sources are: test_table, creator"
      );
    });

    it('applies validated relation paths in sequence', () => {
      const chain: readonly JoinPath<TestSchema>[] = [
        {
          from: 'test_table',
          to: 'users',
          leftColumn: 'created_by',
          rightColumn: 'id',
          alias: 'creator',
        },
        {
          from: 'creator',
          to: 'test_table',
          leftColumn: 'id',
          rightColumn: 'updated_by',
          alias: 'updated_by_user',
        },
      ];

      const result = applyRelationPath(
        baseQuery,
        chain,
        undefined,
        (currentQuery, joinPath) => ({
          ...currentQuery,
          joins: [
            ...(currentQuery.joins || []),
            {
              kind: 'join' as const,
              type: joinPath.type || 'INNER',
              table: String(joinPath.to),
              leftColumn: String(joinPath.leftColumn),
              rightColumn: `${joinPath.alias || String(joinPath.to)}.${joinPath.rightColumn}`,
              alias: joinPath.alias,
            },
          ],
        }),
      );

      expect(result.joins?.map(join => [join.table, join.alias, join.rightColumn])).toEqual([
        ['users', 'creator', 'creator.id'],
        ['test_table', 'updated_by_user', 'updated_by_user.updated_by'],
      ]);
    });
  });
});
