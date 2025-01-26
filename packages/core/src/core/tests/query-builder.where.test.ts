import { QueryBuilder } from '../query-builder';
import { setupTestBuilder, TestSchema } from './test-utils.js';

describe('QueryBuilder - Where Conditions', () => {
    let builder: QueryBuilder<TestSchema>;

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
            expect(sql).toBe("SELECT * FROM test_table WHERE name LIKE '%O'Brien%'");
        });
    });

    describe('edge cases', () => {
        it('should handle boolean values', () => {
            const sql = builder
                .where('active', 'eq', true)
                .toSQL();
            expect(sql).toBe('SELECT * FROM test_table WHERE active = true');
        });

        it('should handle array with special characters in IN', () => {
            const sql = builder
                .where('name', 'in', ["O'Brien", "McDonald's"])
                .toSQL();
            expect(sql).toBe("SELECT * FROM test_table WHERE name IN ('O'Brien', 'McDonald's')");
        });

        it('should handle empty arrays in IN', () => {
            const sql = builder
                .where('id', 'in', [])
                .toSQL();
            expect(sql).toBe('SELECT * FROM test_table WHERE id IN ()');
        });
    });
}); 