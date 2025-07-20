import { JoinRelationships } from '../join-relationships.js';
import { QueryBuilder } from '../query-builder.js';
import { TestSchema, setupTestBuilder } from './test-utils.js';

describe('JoinRelationships', () => {
  let relationships: JoinRelationships<TestSchema>;
  let builder: QueryBuilder<TestSchema, TestSchema['test_table']>;

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

      expect(sql).toBe('SELECT * FROM test_table INNER JOIN users ON created_by = users.id LEFT JOIN test_table AS updated_by_user ON id = test_table.updated_by');
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

    it('should throw error for undefined relationship', () => {
      expect(() => {
        builder.withRelation('nonexistent');
      }).toThrow("Join relationship 'nonexistent' not found");
    });
  });
}); 