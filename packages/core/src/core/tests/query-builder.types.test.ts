import { QueryBuilder } from '../query-builder';
import { setupTestBuilder, TestSchema } from './test-utils.js';
import type { Equal, Expect } from '@type-challenges/utils';

describe('QueryBuilder - Type Safety', () => {
    let builder: QueryBuilder<TestSchema>;

    beforeEach(() => {
        builder = setupTestBuilder();
    });

    it('should return correct types for simple select', () => {
        const query = builder
            .select(['created_at', 'price']);

        type Result = Awaited<ReturnType<typeof query.execute>>;
        type Expected = { created_at: Date; price: number; }[];

        type Assert = Expect<Equal<Result, Expected>> extends true ? true : false;
    });

    it('should return correct types for aggregations', () => {
        const query = builder
            .sum('price')
            .count('price');

        type Result = Awaited<ReturnType<typeof query.execute>>;
        type Expected = {
            price_sum: string;
            price_count: string;
        }[];

        type Assert = Expect<Equal<Result, Expected>> extends true ? true : false;
    });

    it('should return correct types for select with aggregations', () => {
        const query = builder
            .select(['category'])
            .sum('price');

        type Result = Awaited<ReturnType<typeof query.execute>>;
        type Expected = {
            category: string;
            price_sum: string;
        }[];

        type Assert = Expect<Equal<Result, Expected>> extends true ? true : false;
    });
}); 