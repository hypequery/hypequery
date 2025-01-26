import { Equal, Expect } from '@type-challenges/utils';
import { QueryBuilder } from '../query-builder';
import { setupTestBuilder, TestSchema, UsersSchema } from './test-utils.js';

describe('QueryBuilder - Joins', () => {
    let builder: QueryBuilder<TestSchema>;

    beforeEach(() => {
        builder = setupTestBuilder();
    });

    describe('edge cases', () => {
        it('should handle joins with same column names', () => {
            const sql = builder
                .innerJoin(
                    'users',
                    'id',
                    'users.id'
                )
                .select(['test_table.id', 'users.id', 'name'])
                .toSQL();
            expect(sql).toBe('SELECT test_table.id, users.id, name FROM test_table INNER JOIN users ON id = users.id');
        });

        it('should handle multiple joins to same table with aliases', () => {
            const sql = builder
                .innerJoin<{ id: 'Int32' }>('users', 'created_by', 'u1.id', 'u1')
                .innerJoin<{ id: 'Int32' }>('users', 'updated_by', 'u2.id', 'u2')
                .toSQL();
            expect(sql).toBe('SELECT * FROM test_table INNER JOIN users AS u1 ON created_by = u1.id INNER JOIN users AS u2 ON updated_by = u2.id');
        });
    });

    describe('type safety', () => {
        it('should maintain column types from joined tables', () => {
            const query = builder
                .innerJoin<UsersSchema>(
                    'users',
                    'created_by',
                    'users.id'
                )
                .select(['name', 'user_name', 'email']);

            type Result = Awaited<ReturnType<typeof query.execute>>;
            type Expected = {
                name: string;
                user_name: string;
                email: string;
            }[];

            type Assert = Expect<Equal<Result, Expected>>;
        });
    });
}); 