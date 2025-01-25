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

describe('QueryBuilder', () => {
    const schema = {
        name: 'test_table',
        columns: {
            id: 'Int32',
            name: 'String',
            price: 'Float64',
            created_at: 'Date'
        }
    };

    let builder: QueryBuilder<typeof schema.columns>;

    beforeEach(() => {
        builder = new QueryBuilder('test_table', schema);
    });

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

    describe('where', () => {
        it('should add WHERE clause', () => {
            const sql = builder
                .where('price > 100')
                .toSQL();
            expect(sql).toBe('SELECT * FROM test_table WHERE price > 100');
        });

        it('should combine multiple WHERE conditions with AND', () => {
            const sql = builder
                .where('price > 100')
                .where('name LIKE "%test%"')
                .toSQL();
            expect(sql).toBe('SELECT * FROM test_table WHERE price > 100 AND name LIKE "%test%"');
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
}); 