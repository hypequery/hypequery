import { QueryBuilder } from '../query-builder';
import { setupTestBuilder, TestSchema } from './test-utils.js';

describe('QueryBuilder - Pagination', () => {
    let builder: QueryBuilder<TestSchema>;

    beforeEach(() => {
        builder = setupTestBuilder();
    });

    describe('LIMIT', () => {
        it('should add LIMIT clause', () => {
            const sql = builder
                .select(['name', 'price'])
                .limit(10)
                .toSQL();
            expect(sql).toBe('SELECT name, price FROM test_table LIMIT 10');
        });
    });

    describe('OFFSET', () => {
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
                .where('price', 'gt', 100)
                .orderBy('name', 'ASC')
                .limit(10)
                .offset(5)
                .toSQL();
            expect(sql).toBe('SELECT name FROM test_table WHERE price > 100 ORDER BY name ASC LIMIT 10 OFFSET 5');
        });
    });
}); 