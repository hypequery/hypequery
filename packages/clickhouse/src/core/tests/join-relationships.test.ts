import type { Equal, Expect } from '@type-challenges/utils';
import { JoinRelationships } from '../join-relationships.js';
import { QueryBuilder } from '../query-builder.js';
import type { JoinPath } from '../join-relationships.js';
import { TestSchema, setupTestBuilder } from './test-utils.js';

describe('JoinRelationships', () => {
  let relationships: JoinRelationships<TestSchema>;
  let builder: ReturnType<typeof setupTestBuilder>;

  beforeEach(() => {
    relationships = new JoinRelationships<TestSchema>();
    builder = setupTestBuilder();
    QueryBuilder.setJoinRelationships(relationships);
  });

  describe('define', () => {
    it('should define a single join relationship', () => {
      relationships.define('testToUsers', {
        from: 'test_table',
        to: 'users',
        leftColumn: 'created_by',
        rightColumn: 'id'
      });

      expect(relationships.has('testToUsers')).toBe(true);
    });

    it('should throw error for duplicate relationship name', () => {
      relationships.define('testToUsers', {
        from: 'test_table',
        to: 'users',
        leftColumn: 'created_by',
        rightColumn: 'id'
      });

      expect(() => {
        relationships.define('testToUsers', {
          from: 'test_table',
          to: 'users',
          leftColumn: 'updated_by',
          rightColumn: 'id'
        });
      }).toThrow("Join relationship 'testToUsers' is already defined");
    });
  });

  describe('defineChain', () => {
    it('should define a chain of joins', () => {
      relationships.defineChain('complexChain', [
        {
          from: 'test_table',
          to: 'users',
          leftColumn: 'created_by',
          rightColumn: 'id',
          type: 'INNER'
        },
        {
          from: 'users',
          to: 'test_table',
          leftColumn: 'id',
          rightColumn: 'updated_by',
          type: 'LEFT'
        }
      ]);

      expect(relationships.has('complexChain')).toBe(true);
    });

    it('should throw error for empty chain', () => {
      expect(() => {
        relationships.defineChain('emptyChain', []);
      }).toThrow('Join chain must contain at least one path');
    });
  });

  describe('QueryBuilder integration', () => {
    it('should apply single join relationship', () => {
      relationships.define('testToUsers', {
        from: 'test_table',
        to: 'users',
        leftColumn: 'created_by',
        rightColumn: 'id'
      });

      const sql = builder
        .withRelation('testToUsers')
        .toSQL();

      expect(sql).toBe('SELECT * FROM test_table INNER JOIN users ON created_by = users.id');
    });

    it('should apply join chain', () => {
      relationships.defineChain('complexChain', [
        {
          from: 'test_table',
          to: 'users',
          leftColumn: 'created_by',
          rightColumn: 'id',
          type: 'INNER'
        },
        {
          from: 'users',
          to: 'test_table',
          leftColumn: 'id',
          rightColumn: 'updated_by',
          type: 'LEFT',
          alias: 'updated_by_user'
        }
      ]);

      const sql = builder
        .withRelation('complexChain')
        .toSQL();

      expect(sql).toBe('SELECT * FROM test_table INNER JOIN users ON created_by = users.id LEFT JOIN test_table AS updated_by_user ON id = updated_by_user.updated_by');
    });

    it('should apply join chains that continue from a prior alias', () => {
      relationships.defineChain('aliasChain', [
        {
          from: 'test_table',
          to: 'users',
          leftColumn: 'created_by',
          rightColumn: 'id',
          type: 'INNER',
          alias: 'creator'
        },
        {
          from: 'creator',
          to: 'test_table',
          leftColumn: 'id',
          rightColumn: 'updated_by',
          type: 'LEFT',
          alias: 'updated_by_user'
        }
      ]);

      const sql = builder
        .withRelation('aliasChain')
        .toSQL();

      expect(sql).toBe('SELECT * FROM test_table INNER JOIN users AS creator ON created_by = creator.id LEFT JOIN test_table AS updated_by_user ON id = updated_by_user.updated_by');
    });

    it('should override join type', () => {
      relationships.define('testToUsers', {
        from: 'test_table',
        to: 'users',
        leftColumn: 'created_by',
        rightColumn: 'id',
        type: 'INNER'
      });

      const sql = builder
        .withRelation('testToUsers', { type: 'LEFT' })
        .toSQL();

      expect(sql).toBe('SELECT * FROM test_table LEFT JOIN users ON created_by = users.id');
    });

    it('should support typed direct join paths with alias-aware selection', () => {
      const orderCustomerPath = {
        from: 'test_table',
        to: 'users',
        leftColumn: 'created_by',
        rightColumn: 'id',
        alias: 'author'
      } as const satisfies JoinPath<TestSchema>;

      const query = builder
        .withRelation(orderCustomerPath)
        .select(['author.user_name']);

      type Result = Awaited<ReturnType<typeof query.execute>>;
      type Expected = { user_name: string }[];
      type _Assert = Expect<Equal<Result, Expected>>;

      expect(query.toSQL()).toBe(
        'SELECT author.user_name FROM test_table INNER JOIN users AS author ON created_by = author.id'
      );
    });

    it('should support alias override for a direct single-join path', () => {
      const orderCustomerPath = {
        from: 'test_table',
        to: 'users',
        leftColumn: 'created_by',
        rightColumn: 'id',
      } as const satisfies JoinPath<TestSchema>;

      const query = builder
        .withRelation(orderCustomerPath, { type: 'LEFT', alias: 'customer' })
        .select(['customer.email']);

      type Result = Awaited<ReturnType<typeof query.execute>>;
      type Expected = { email: string }[];
      type _Assert = Expect<Equal<Result, Expected>>;

      expect(query.toSQL()).toBe(
        'SELECT customer.email FROM test_table LEFT JOIN users AS customer ON created_by = customer.id'
      );
    });

    it('should throw when alias override is used for a join chain', () => {
      relationships.defineChain('complexChain', [
        {
          from: 'test_table',
          to: 'users',
          leftColumn: 'created_by',
          rightColumn: 'id',
          type: 'INNER'
        },
        {
          from: 'users',
          to: 'test_table',
          leftColumn: 'id',
          rightColumn: 'updated_by',
          type: 'LEFT'
        }
      ]);

      expect(() => {
        builder.withRelation('complexChain', { alias: 'customer' });
      }).toThrow(
        "Join relationship 'complexChain' is a chain; alias override is only supported for single-join relationships"
      );
    });

    it('should throw when a single relationship starts from an unavailable source', () => {
      relationships.define('usersToTestTable', {
        from: 'users',
        to: 'test_table',
        leftColumn: 'id',
        rightColumn: 'updated_by',
        type: 'LEFT'
      });

      expect(() => {
        builder.withRelation('usersToTestTable');
      }).toThrow(
        "Join relationship 'usersToTestTable' step 1 expects source 'users', but available sources are: test_table"
      );
    });

    it('should throw when a join chain references an unavailable intermediate source', () => {
      relationships.defineChain('brokenChain', [
        {
          from: 'test_table',
          to: 'users',
          leftColumn: 'created_by',
          rightColumn: 'id',
          type: 'INNER',
          alias: 'creator'
        },
        {
          from: 'users',
          to: 'test_table',
          leftColumn: 'id',
          rightColumn: 'updated_by',
          type: 'LEFT'
        }
      ]);

      expect(() => {
        builder.withRelation('brokenChain');
      }).toThrow(
        "Join relationship 'brokenChain' step 2 expects source 'users', but available sources are: test_table, creator"
      );
    });

    it('should throw error for undefined relationship', () => {
      expect(() => {
        builder.withRelation('nonexistent');
      }).toThrow("Join relationship 'nonexistent' not found");
    });
  });
}); 
