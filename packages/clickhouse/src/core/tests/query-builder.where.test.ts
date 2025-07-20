import { QueryBuilder } from '../query-builder.js';
import { setupTestBuilder, TestSchema } from './test-utils.js';

describe('QueryBuilder - Where Conditions', () => {
  let builder: QueryBuilder<TestSchema, TestSchema['test_table'], true, {}>;

  beforeEach(() => {
    builder = setupTestBuilder();
  });

  describe('basic conditions', () => {
    it('should handle all comparison operators', () => {
      const operators = [
        ['eq', '='],
        ['neq', '!='],
        ['gt', '>'],
        ['gte', '>='],
        ['lt', '<'],
        ['lte', '<=']
      ];

      operators.forEach(([op, sql]) => {
        const query = setupTestBuilder()
          .where('price', op as any, 100)
          .toSQL();
        expect(query).toBe(`SELECT * FROM test_table WHERE price ${sql} 100`);
      });
    });

    it('should handle special characters in LIKE', () => {
      const sql = builder
        .where('name', 'like', "%O'Brien%")
        .toSQL();
      expect(sql).toBe("SELECT * FROM test_table WHERE name LIKE '%O''Brien%'");
    });
  });

  describe('orWhere conditions', () => {
    it('should handle simple OR conditions', () => {
      const sql = builder
        .where('category', 'eq', 'electronics')
        .orWhere('price', 'gt', 1000)
        .toSQL();
      expect(sql).toBe("SELECT * FROM test_table WHERE category = 'electronics' OR price > 1000");
    });

    it('should handle multiple OR conditions', () => {
      const sql = builder
        .where('active', 'eq', 1)
        .orWhere('category', 'eq', 'premium')
        .orWhere('price', 'gte', 500)
        .toSQL();
      expect(sql).toBe("SELECT * FROM test_table WHERE active = 1 OR category = 'premium' OR price >= 500");
    });

    it('should handle OR with different operators', () => {
      const sql = builder
        .where('name', 'like', '%test%')
        .orWhere('price', 'between', [100, 200])
        .orWhere('category', 'in', ['electronics', 'books'])
        .toSQL();
      expect(sql).toBe("SELECT * FROM test_table WHERE name LIKE '%test%' OR price BETWEEN 100 AND 200 OR category IN ('electronics', 'books')");
    });
  });

  describe('whereGroup conditions', () => {
    it('should handle simple whereGroup', () => {
      const sql = builder
        .whereGroup((qb) => {
          qb.where('price', 'gte', 100)
            .orWhere('category', 'eq', 'premium');
        })
        .toSQL();
      expect(sql).toBe("SELECT * FROM test_table WHERE (price >= 100 OR category = 'premium')");
    });

    it('should handle whereGroup with external conditions', () => {
      const sql = builder
        .where('active', 'eq', 1)
        .whereGroup((qb) => {
          qb.where('price', 'gte', 100)
            .orWhere('category', 'eq', 'premium');
        })
        .where('created_at', 'gte', '2024-01-01')
        .toSQL();
      expect(sql).toBe("SELECT * FROM test_table WHERE active = 1 AND (price >= 100 OR category = 'premium') AND created_at >= '2024-01-01'");
    });

    it('should handle multiple whereGroup calls', () => {
      const sql = builder
        .whereGroup((qb) => {
          qb.where('price', 'gte', 100)
            .orWhere('category', 'eq', 'premium');
        })
        .whereGroup((qb) => {
          qb.where('active', 'eq', 1)
            .orWhere('created_by', 'eq', 1);
        })
        .toSQL();
      expect(sql).toBe("SELECT * FROM test_table WHERE (price >= 100 OR category = 'premium') AND (active = 1 OR created_by = 1)");
    });
  });

  describe('orWhereGroup conditions', () => {
    it('should handle simple orWhereGroup', () => {
      const sql = builder
        .where('active', 'eq', 1)
        .orWhereGroup((qb) => {
          qb.where('price', 'gte', 1000)
            .orWhere('category', 'eq', 'luxury');
        })
        .toSQL();
      expect(sql).toBe("SELECT * FROM test_table WHERE active = 1 OR (price >= 1000 OR category = 'luxury')");
    });

    it('should handle multiple orWhereGroup calls', () => {
      const sql = builder
        .where('active', 'eq', 1)
        .orWhereGroup((qb) => {
          qb.where('price', 'gte', 1000)
            .orWhere('category', 'eq', 'luxury');
        })
        .orWhereGroup((qb) => {
          qb.where('created_by', 'eq', 1)
            .orWhere('updated_by', 'eq', 1);
        })
        .toSQL();
      expect(sql).toBe("SELECT * FROM test_table WHERE active = 1 OR (price >= 1000 OR category = 'luxury') OR (created_by = 1 OR updated_by = 1)");
    });
  });

  describe('nested group conditions', () => {
    it('should handle nested whereGroup inside whereGroup', () => {
      const sql = builder
        .whereGroup((qb) => {
          qb.where('active', 'eq', 1)
            .whereGroup((innerQb) => {
              innerQb.where('price', 'gte', 100)
                .orWhere('category', 'eq', 'premium');
            });
        })
        .toSQL();
      expect(sql).toBe("SELECT * FROM test_table WHERE (active = 1 AND (price >= 100 OR category = 'premium'))");
    });

    it('should handle orWhereGroup inside whereGroup', () => {
      const sql = builder
        .whereGroup((qb) => {
          qb.where('status', 'eq', 'completed')
            .orWhereGroup((innerQb) => {
              innerQb.where('total', 'gte', 100)
                .orWhere('priority', 'eq', 'high');
            });
        })
        .toSQL();
      expect(sql).toBe("SELECT * FROM test_table WHERE (status = 'completed' OR (total >= 100 OR priority = 'high'))");
    });

    it('should handle whereGroup inside orWhereGroup', () => {
      const sql = builder
        .where('active', 'eq', 1)
        .orWhereGroup((qb) => {
          qb.where('price', 'gte', 1000)
            .whereGroup((innerQb) => {
              innerQb.where('category', 'eq', 'luxury')
                .orWhere('brand', 'eq', 'premium');
            });
        })
        .toSQL();
      expect(sql).toBe("SELECT * FROM test_table WHERE active = 1 OR (price >= 1000 AND (category = 'luxury' OR brand = 'premium'))");
    });

    it('should handle deeply nested groups', () => {
      const sql = builder
        .whereGroup((qb) => {
          qb.where('active', 'eq', 1)
            .whereGroup((innerQb) => {
              innerQb.where('price', 'gte', 100)
                .orWhereGroup((deepQb) => {
                  deepQb.where('category', 'eq', 'premium')
                    .orWhere('brand', 'eq', 'luxury');
                });
            });
        })
        .toSQL();
      expect(sql).toBe("SELECT * FROM test_table WHERE (active = 1 AND (price >= 100 OR (category = 'premium' OR brand = 'luxury')))");
    });
  });

  describe('complex mixed conditions', () => {
    it('should handle complex mixed AND/OR conditions', () => {
      const sql = builder
        .where('active', 'eq', 1)
        .whereGroup((qb) => {
          qb.where('price', 'gte', 100)
            .orWhere('category', 'eq', 'premium');
        })
        .orWhere('created_by', 'eq', 1)
        .whereGroup((qb) => {
          qb.where('updated_by', 'eq', 1)
            .orWhere('category', 'eq', 'admin');
        })
        .toSQL();
      expect(sql).toBe("SELECT * FROM test_table WHERE active = 1 AND (price >= 100 OR category = 'premium') OR created_by = 1 AND (updated_by = 1 OR category = 'admin')");
    });

    it('should handle multiple conditions with groups', () => {
      const sql = builder
        .where('active', 'eq', 1)
        .orWhereGroup((qb) => {
          qb.where('price', 'gte', 1000)
            .orWhere('category', 'eq', 'luxury');
        })
        .where('created_at', 'gte', '2024-01-01')
        .orWhereGroup((qb) => {
          qb.where('updated_by', 'eq', 1)
            .orWhere('created_by', 'eq', 1);
        })
        .toSQL();
      expect(sql).toBe("SELECT * FROM test_table WHERE active = 1 OR (price >= 1000 OR category = 'luxury') AND created_at >= '2024-01-01' OR (updated_by = 1 OR created_by = 1)");
    });
  });

  describe('edge cases', () => {
    it('should handle boolean values', () => {
      const sql = builder
        .where('active', 'eq', 1)
        .toSQL();
      expect(sql).toBe('SELECT * FROM test_table WHERE active = 1');
    });

    it('should handle array with special characters in IN', () => {
      const sql = builder
        .where('name', 'in', ["O'Brien", "McDonald's"])
        .toSQL();
      expect(sql).toBe("SELECT * FROM test_table WHERE name IN ('O''Brien', 'McDonald''s')");
    });

    it('should handle empty arrays in IN', () => {
      const sql = builder
        .where('id', 'in', [])
        .toSQL();
      expect(sql).toBe('SELECT * FROM test_table WHERE 1 = 0');
    });

    it('should handle empty whereGroup', () => {
      const sql = builder
        .whereGroup((qb) => {
          // Empty group
        })
        .toSQL();
      expect(sql).toBe('SELECT * FROM test_table WHERE ()');
    });

    it('should handle single condition in whereGroup', () => {
      const sql = builder
        .whereGroup((qb) => {
          qb.where('active', 'eq', 1);
        })
        .toSQL();
      expect(sql).toBe('SELECT * FROM test_table WHERE (active = 1)');
    });

    it('should handle single condition in orWhereGroup', () => {
      const sql = builder
        .where('active', 'eq', 1)
        .orWhereGroup((qb) => {
          qb.where('price', 'gte', 1000);
        })
        .toSQL();
      expect(sql).toBe('SELECT * FROM test_table WHERE active = 1 OR (price >= 1000)');
    });
  });
}); 