import { QueryBuilder } from '../query-builder';
import { setupTestBuilder, TestSchema } from './test-utils.js';

describe('QueryBuilder - Aggregations', () => {
    let builder: QueryBuilder<TestSchema>;

    beforeEach(() => {
        builder = setupTestBuilder();
    });

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

    it('should combine multiple aggregations', () => {
        const sql = builder
            .select(['name'])
            .sum('price')
            .count('id')
            .toSQL();
        expect(sql).toBe('SELECT name, SUM(price) AS price_sum, COUNT(id) AS id_count FROM test_table GROUP BY name');
    });

    describe('HAVING', () => {
        it('should add HAVING clause', () => {
            const sql = builder
                .select(['name'])
                .sum('price')
                .groupBy('name')
                .having('price_sum > 1000')
                .toSQL();
            expect(sql).toBe('SELECT name, SUM(price) AS price_sum FROM test_table GROUP BY name HAVING price_sum > 1000');
        });

        it('should combine multiple HAVING conditions', () => {
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
}); 