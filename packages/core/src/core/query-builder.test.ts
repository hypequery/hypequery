import { QueryBuilder, createQueryBuilder } from './query-builder';
import { ClickHouseConnection } from './connection';

// Mock ClickHouseConnection
jest.mock('./connection', () => ({
    ClickHouseConnection: {
        initialize: jest.fn(),
        getClient: jest.fn(() => ({
            query: jest.fn().mockResolvedValue({
                json: jest.fn().mockResolvedValue([])
            })
        }))
    }
}));

type TestSchema = {
    id: 'Int32',
    name: 'String',
    price: 'Float64',
    created_at: 'Date',
    category: 'String'
};

const schema = {
    name: 'test_table',
    columns: {
        id: 'Int32',
        name: 'String',
        price: 'Float64',
        created_at: 'Date',
        category: 'String'
    } satisfies TestSchema
};

let builder: QueryBuilder<TestSchema>;

beforeEach(() => {
    builder = new QueryBuilder('test_table', schema);
});

describe('QueryBuilder', () => {
    describe('select', () => {
        it('should build SELECT query with specific columns', () => {
            const sql = builder
                .select(['id', 'name'])
                .toSQL();
            expect(sql).toBe('SELECT id, name FROM test_table');
        });
    });

    describe('aggregations', () => {
        it('should build query with SUM', () => {
            const sql = builder
                .sum('price')
                .toSQL();
            expect(sql).toBe('SELECT SUM(price) AS price_sum FROM test_table');
        });

        it('should build query with COUNT', () => {
            const sql = builder
                .count('id')
                .toSQL();
            expect(sql).toBe('SELECT COUNT(id) AS id_count FROM test_table');
        });

        it('should build query with AVG', () => {
            const sql = builder
                .avg('price')
                .toSQL();
            expect(sql).toBe('SELECT AVG(price) AS price_avg FROM test_table');
        });

        it('should build query with MIN', () => {
            const sql = builder
                .min('price')
                .toSQL();
            expect(sql).toBe('SELECT MIN(price) AS price_min FROM test_table');
        });

        it('should build query with MAX', () => {
            const sql = builder
                .max('price')
                .toSQL();
            expect(sql).toBe('SELECT MAX(price) AS price_max FROM test_table');
        });

        it('should combine multiple aggregations', () => {
            const sql = builder
                .select(['name'])
                .sum('price')
                .count('id')
                .toSQL();
            expect(sql).toBe('SELECT name, SUM(price) AS price_sum, COUNT(id) AS id_count FROM test_table GROUP BY name');
        });
    });

    describe('where conditions', () => {
        describe('where (AND)', () => {
            it('should add single WHERE condition', () => {
                const sql = builder
                    .where('price > 100')
                    .toSQL();
                expect(sql).toBe('SELECT * FROM test_table WHERE price > 100');
            });

            it('should combine multiple WHERE conditions with AND', () => {
                const sql = builder
                    .where('price > 100')
                    .where('name = "test"')
                    .toSQL();
                expect(sql).toBe('SELECT * FROM test_table WHERE price > 100 AND name = "test"');
            });
        });

        describe('orWhere', () => {
            it('should add single OR condition', () => {
                const sql = builder
                    .orWhere('price > 100')
                    .toSQL();
                expect(sql).toBe('SELECT * FROM test_table WHERE price > 100');
            });

            it('should combine multiple OR conditions', () => {
                const sql = builder
                    .orWhere('price > 100')
                    .orWhere('price < 50')
                    .toSQL();
                expect(sql).toBe('SELECT * FROM test_table WHERE price > 100 OR price < 50');
            });
        });

        describe('where and orWhere combinations', () => {
            it('should combine WHERE and OR WHERE', () => {
                const sql = builder
                    .where('price > 100')
                    .orWhere('name = "test"')
                    .toSQL();
                expect(sql).toBe('SELECT * FROM test_table WHERE price > 100 OR name = "test"');
            });

            it('should handle complex combinations', () => {
                const sql = builder
                    .where('price > 100')
                    .where('category = "A"')
                    .orWhere('name = "test"')
                    .where('status = "active"')
                    .orWhere('rating > 4')
                    .toSQL();
                expect(sql).toBe('SELECT * FROM test_table WHERE price > 100 AND category = "A" OR name = "test" AND status = "active" OR rating > 4');
            });

            it('should work with other clauses', () => {
                const sql = builder
                    .select(['name', 'price', 'category'])
                    .where('price > 100')
                    .orWhere('name = "test"')
                    .groupBy('category')
                    .having('COUNT(*) > 1')
                    .orderBy('price', 'DESC')
                    .limit(10)
                    .toSQL();
                expect(sql).toBe('SELECT name, price, category FROM test_table WHERE price > 100 OR name = "test" GROUP BY category HAVING COUNT(*) > 1 ORDER BY price DESC LIMIT 10');
            });
        });

        describe('whereIn with where combinations', () => {
            it('should combine whereIn with where', () => {
                const sql = builder
                    .where('price > 100')
                    .whereIn('name', ['test1', 'test2'])
                    .orWhere('status = "active"')
                    .toSQL();
                expect(sql).toBe('SELECT * FROM test_table WHERE price > 100 AND name IN (\'test1\', \'test2\') OR status = "active"');
            });
        });
    });

    describe('groupBy', () => {
        it('should add GROUP BY for single column', () => {
            const sql = builder
                .select(['name'])
                .sum('price')
                .groupBy('name')
                .toSQL();
            expect(sql).toBe('SELECT name, SUM(price) AS price_sum FROM test_table GROUP BY name');
        });

        it('should add GROUP BY for multiple columns', () => {
            const sql = builder
                .select(['name', 'created_at'])
                .sum('price')
                .groupBy(['name', 'created_at'])
                .toSQL();
            expect(sql).toBe('SELECT name, created_at, SUM(price) AS price_sum FROM test_table GROUP BY name, created_at');
        });
    });

    describe('having', () => {
        it('should add HAVING clause', () => {
            const sql = builder
                .select(['name'])
                .sum('price')
                .groupBy('name')
                .having('price_sum > 1000')
                .toSQL();
            expect(sql).toBe('SELECT name, SUM(price) AS price_sum FROM test_table GROUP BY name HAVING price_sum > 1000');
        });

        it('should combine multiple HAVING conditions with AND', () => {
            const sql = builder
                .select(['name'])
                .sum('price')
                .count('id')
                .groupBy('name')
                .having('price_sum > 1000')
                .having('id_count > 5')
                .toSQL();
            expect(sql).toBe('SELECT name, SUM(price) AS price_sum, COUNT(id) AS id_count FROM test_table GROUP BY name HAVING price_sum > 1000 AND id_count > 5');
        });
    });

    describe('orderBy', () => {
        it('should add ORDER BY clause', () => {
            const sql = builder
                .select(['name', 'price'])
                .orderBy('price', 'DESC')
                .toSQL();
            expect(sql).toBe('SELECT name, price FROM test_table ORDER BY price DESC');
        });

        it('should combine multiple ORDER BY clauses', () => {
            const sql = builder
                .select(['name', 'price'])
                .orderBy('price', 'DESC')
                .orderBy('name', 'ASC')
                .toSQL();
            expect(sql).toBe('SELECT name, price FROM test_table ORDER BY price DESC, name ASC');
        });
    });

    describe('limit', () => {
        it('should add LIMIT clause', () => {
            const sql = builder
                .select(['name', 'price'])
                .limit(10)
                .toSQL();
            expect(sql).toBe('SELECT name, price FROM test_table LIMIT 10');
        });
    });

    describe('execute', () => {
        it('should execute query and return results', async () => {
            const results = await builder
                .select(['name', 'price'])
                .execute();
            expect(ClickHouseConnection.getClient).toHaveBeenCalled();
            expect(results).toEqual([]);
        });
    });

    describe('createQueryBuilder', () => {
        it('should create a new query builder instance', () => {
            const db = createQueryBuilder({
                host: 'localhost',
                username: 'user',
                password: 'pass'
            });
            expect(ClickHouseConnection.initialize).toHaveBeenCalledWith({
                host: 'localhost',
                username: 'user',
                password: 'pass'
            });
            expect(db.table).toBeDefined();
        });
    });

    describe('debug', () => {
        it('should return current builder state', () => {
            const spy = jest.spyOn(console, 'log').mockImplementation();
            builder
                .select(['name'])
                .where('price > 100')
                .debug();
            expect(spy).toHaveBeenCalled();
            spy.mockRestore();
        });
    });

    describe('distinct', () => {
        it('should add DISTINCT keyword to SELECT', () => {
            const sql = builder
                .distinct()
                .select(['name'])
                .toSQL();
            expect(sql).toBe('SELECT DISTINCT name FROM test_table');
        });

        it('should work with DISTINCT and no SELECT', () => {
            const sql = builder
                .distinct()
                .toSQL();
            expect(sql).toBe('SELECT DISTINCT * FROM test_table');
        });

        it('should work with other clauses', () => {
            const sql = builder
                .distinct()
                .select(['name', 'price'])
                .where('price > 100')
                .groupBy('name')
                .having('COUNT(*) > 1')
                .orderBy('price', 'DESC')
                .limit(10)
                .toSQL();
            expect(sql).toBe('SELECT DISTINCT name, price FROM test_table WHERE price > 100 GROUP BY name HAVING COUNT(*) > 1 ORDER BY price DESC LIMIT 10');
        });

        it('should work with aggregations', () => {
            const sql = builder
                .distinct()
                .select(['name'])
                .sum('price')
                .toSQL();
            expect(sql).toBe('SELECT DISTINCT name, SUM(price) AS price_sum FROM test_table GROUP BY name');
        });
    });

    describe('offset', () => {
        it('should add OFFSET to LIMIT clause', () => {
            const sql = builder
                .select(['name', 'price'])
                .limit(10)
                .offset(20)
                .toSQL();
            expect(sql).toBe('SELECT name, price FROM test_table LIMIT 10 OFFSET 20');
        });

        it('should work with other clauses', () => {
            const sql = builder
                .select(['name'])
                .where('price > 100')
                .orderBy('name', 'ASC')
                .limit(10)
                .offset(5)
                .toSQL();
            expect(sql).toBe('SELECT name FROM test_table WHERE price > 100 ORDER BY name ASC LIMIT 10 OFFSET 5');
        });
    });

    describe('whereIn', () => {
        it('should add WHERE IN clause for strings', () => {
            const sql = builder
                .whereIn('name', ['test1', 'test2', 'test3'])
                .toSQL();
            expect(sql).toBe("SELECT * FROM test_table WHERE name IN ('test1', 'test2', 'test3')");
        });

        it('should add WHERE IN clause for numbers', () => {
            const sql = builder
                .whereIn('price', [100, 200, 300])
                .toSQL();
            expect(sql).toBe('SELECT * FROM test_table WHERE price IN (100, 200, 300)');
        });

        it('should work with other clauses', () => {
            const sql = builder
                .select(['name', 'price'])
                .where('price > 100')
                .whereIn('name', ['test1', 'test2'])
                .orderBy('price', 'DESC')
                .toSQL();
            expect(sql).toBe("SELECT name, price FROM test_table WHERE price > 100 AND name IN ('test1', 'test2') ORDER BY price DESC");
        });
    });

    describe('whereBetween', () => {
        it('should add BETWEEN clause for numbers', () => {
            const sql = builder
                .whereBetween('price', [100, 200])
                .toSQL();
            expect(sql).toBe('SELECT * FROM test_table WHERE price BETWEEN 100 AND 200');
        });

        it('should add BETWEEN clause for strings', () => {
            const sql = builder
                .whereBetween('name', ['A', 'M'])
                .toSQL();
            expect(sql).toBe("SELECT * FROM test_table WHERE name BETWEEN 'A' AND 'M'");
        });

        it('should add BETWEEN clause for dates', () => {
            const start = new Date('2023-01-01');
            const end = new Date('2023-12-31');
            const sql = builder
                .whereBetween('created_at', [start, end])
                .toSQL();
            expect(sql).toBe('SELECT * FROM test_table WHERE created_at BETWEEN 2023-01-01 AND 2023-12-31');
        });

        it('should combine with other where conditions', () => {
            const sql = builder
                .where('category = "residential"')
                .whereBetween('price', [100000, 200000])
                .orWhere('status = "premium"')
                .toSQL();
            expect(sql).toBe('SELECT * FROM test_table WHERE category = "residential" AND price BETWEEN 100000 AND 200000 OR status = "premium"');
        });

        it('should work with other query clauses', () => {
            const sql = builder
                .select(['name', 'price'])
                .whereBetween('price', [100, 200])
                .groupBy('name')
                .having('COUNT(*) > 1')
                .orderBy('price', 'DESC')
                .toSQL();
            expect(sql).toBe('SELECT name, price FROM test_table WHERE price BETWEEN 100 AND 200 GROUP BY name HAVING COUNT(*) > 1 ORDER BY price DESC');
        });

        it('should handle null values appropriately', () => {
            expect(() => {
                // @ts-expect-error
                builder.whereBetween('price', [null, 200]);
            }).toThrow();

            expect(() => {
                // @ts-expect-error
                builder.whereBetween('price', [100, null]);
            }).toThrow();
        });

        it('should handle empty string values', () => {
            const sql = builder
                .whereBetween('name', ['', 'Z'])
                .toSQL();
            expect(sql).toBe("SELECT * FROM test_table WHERE name BETWEEN '' AND 'Z'");
        });
    });
}); 