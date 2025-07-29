import { createQueryBuilder } from '../query-builder.js';

// Test schema with cross-database support
interface TestCrossDatabaseSchema {
  // Default database tables
  users: { id: 'UInt64'; name: 'String'; email: 'String' };
  posts: { id: 'UInt64'; title: 'String'; user_id: 'UInt64' };

  // Cross-database tables
  __databases: {
    information_schema: {
      tables: { table_name: 'String'; table_schema: 'String'; table_type: 'String' };
      query_log: { query: 'String'; event_time: 'DateTime'; user: 'String' };
    };

    system: {
      tables: { database: 'String'; name: 'String'; engine: 'String' };
      query_log: { query: 'String'; event_time: 'DateTime'; user: 'String' };
    };
  }
}

describe('Cross-Database Join Functionality', () => {
  let db: ReturnType<typeof createQueryBuilder<TestCrossDatabaseSchema>>;

  beforeEach(() => {
    db = createQueryBuilder<TestCrossDatabaseSchema>({
      host: 'http://localhost:8123',
      username: 'default',
      password: '',
      database: 'default'
    });
  });

  describe('Same-Database Joins (Backward Compatibility)', () => {
    it('should support same-database INNER JOIN', () => {
      const query = db.table('users')
        .innerJoin('posts', 'id', 'posts.user_id')
        .select(['users.name', 'posts.title'])
        .toSQL();

      expect(query).toContain('INNER JOIN posts ON id = posts.user_id');
    });

    it('should support same-database LEFT JOIN', () => {
      const query = db.table('users')
        .leftJoin('posts', 'id', 'posts.user_id')
        .select(['users.name', 'posts.title'])
        .toSQL();

      expect(query).toContain('LEFT JOIN posts ON id = posts.user_id');
    });

    it('should support same-database RIGHT JOIN', () => {
      const query = db.table('users')
        .rightJoin('posts', 'id', 'posts.user_id')
        .select(['users.name', 'posts.title'])
        .toSQL();

      expect(query).toContain('RIGHT JOIN posts ON id = posts.user_id');
    });

    it('should support same-database FULL JOIN', () => {
      const query = db.table('users')
        .fullJoin('posts', 'id', 'posts.user_id')
        .select(['users.name', 'posts.title'])
        .toSQL();

      expect(query).toContain('FULL JOIN posts ON id = posts.user_id');
    });
  });

  describe('Cross-Database Joins', () => {
    it('should support cross-database INNER JOIN', () => {
      const query = db.table('users')
        .innerJoin('information_schema.tables', 'name', 'information_schema.tables.table_name')
        .select(['users.name', 'information_schema.tables.table_type'])
        .toSQL();

      expect(query).toContain('INNER JOIN `information_schema`.`tables` ON name = information_schema.tables.table_name');
    });

    it('should support cross-database LEFT JOIN', () => {
      const query = db.table('users')
        .leftJoin('information_schema.tables', 'name', 'information_schema.tables.table_name')
        .select(['users.name', 'information_schema.tables.table_type'])
        .toSQL();

      expect(query).toContain('LEFT JOIN `information_schema`.`tables` ON name = information_schema.tables.table_name');
    });

    it('should support cross-database RIGHT JOIN', () => {
      const query = db.table('users')
        .rightJoin('system.tables', 'id', 'system.tables.database')
        .select(['users.name', 'system.tables.engine'])
        .toSQL();

      expect(query).toContain('RIGHT JOIN `system`.`tables` ON id = system.tables.database');
    });

    it('should support cross-database FULL JOIN', () => {
      const query = db.table('users')
        .fullJoin('system.tables', 'name', 'system.tables.name')
        .select(['users.name', 'system.tables.engine'])
        .toSQL();

      expect(query).toContain('FULL JOIN `system`.`tables` ON name = system.tables.name');
    });
  });

  describe('Complex Cross-Database Queries', () => {
    it('should support multiple cross-database joins', () => {
      const query = db.table('users')
        .leftJoin('information_schema.tables', 'name', 'information_schema.tables.table_name', 'ist')
        .innerJoin('system.tables', 'id', 'system.tables.database', 'st')
        .select(['users.name', 'ist.table_type' as any, 'st.engine' as any])
        .where('ist.table_schema' as any, 'eq', 'default')
        .where('st.database' as any, 'eq', 'default')
        .orderBy('users.name', 'ASC')
        .limit(10)
        .toSQL();

      expect(query).toContain('LEFT JOIN `information_schema`.`tables` AS ist ON name = information_schema.tables.table_name');
      expect(query).toContain('INNER JOIN `system`.`tables` AS st ON id = system.tables.database');
      expect(query).toContain("WHERE ist.table_schema = 'default' AND st.database = 'default'");
      expect(query).toContain('ORDER BY users.name ASC');
      expect(query).toContain('LIMIT 10');
    });

    it('should support mixed same-database and cross-database joins', () => {
      const query = db.table('users')
        .leftJoin('posts', 'id', 'posts.user_id')
        .leftJoin('information_schema.tables', 'name', 'information_schema.tables.table_name')
        .select(['users.name', 'posts.title', 'information_schema.tables.table_type'])
        .toSQL();

      expect(query).toContain('LEFT JOIN posts ON id = posts.user_id');
      expect(query).toContain('LEFT JOIN `information_schema`.`tables` ON name = information_schema.tables.table_name');
    });
  });

  describe('Table Name Parsing', () => {
    it('should correctly parse same-database table names', () => {
      const query = db.table('users')
        .leftJoin('posts', 'id', 'posts.user_id')
        .toSQL();

      expect(query).toContain('LEFT JOIN posts ON id = posts.user_id');
      expect(query).not.toContain('`posts`');
    });

    it('should correctly parse cross-database table names', () => {
      const query = db.table('users')
        .leftJoin('information_schema.tables', 'id', 'information_schema.tables.table_name')
        .toSQL();

      expect(query).toContain('LEFT JOIN `information_schema`.`tables` ON id = information_schema.tables.table_name');
    });

    it('should handle table names with special characters', () => {
      const query = db.table('users')
        .leftJoin('information_schema.tables', 'id', 'information_schema.tables.table_name')
        .toSQL();

      expect(query).toContain('LEFT JOIN `information_schema`.`tables` ON id = information_schema.tables.table_name');
    });
  });

  describe('Type Safety', () => {
    it('should provide type safety for same-database tables', () => {
      // This should compile without errors
      const query = db.table('users')
        .leftJoin('posts', 'id', 'posts.user_id')
        .select(['users.name', 'posts.title'])
        .toSQL();

      expect(typeof query).toBe('string');
    });

    it('should provide type safety for cross-database tables', () => {
      // This should compile without errors
      const query = db.table('users')
        .leftJoin('information_schema.tables', 'name', 'information_schema.tables.table_name')
        .select(['users.name', 'information_schema.tables.table_type'])
        .toSQL();

      expect(typeof query).toBe('string');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid table names gracefully', () => {
      // This should not throw an error during SQL generation
      const query = db.table('users')
        // @ts-expect-error - invalid table name
        .leftJoin('invalid.table', 'id', 'invalid.table.column')
        .toSQL();

      expect(query).toContain('LEFT JOIN `invalid`.`table` ON id = invalid.table.column');
    });
  });

  describe('SQL Generation', () => {
    it('should generate correct SQL for complex cross-database query', () => {
      const query = db.table('users')
        .leftJoin('information_schema.tables', 'name', 'information_schema.tables.table_name')
        .select(['users.name', 'information_schema.tables.table_type'])
        .where('information_schema.tables.table_schema', 'eq', 'default')
        .orderBy('users.name', 'ASC')
        .limit(5)
        .toSQL();

      const expectedParts = [
        'SELECT users.name, information_schema.tables.table_type',
        'FROM users',
        'LEFT JOIN `information_schema`.`tables` ON name = information_schema.tables.table_name',
        "WHERE information_schema.tables.table_schema = 'default'",
        'ORDER BY users.name ASC',
        'LIMIT 5'
      ];

      expectedParts.forEach(part => {
        expect(query).toContain(part);
      });
    });
  });
});