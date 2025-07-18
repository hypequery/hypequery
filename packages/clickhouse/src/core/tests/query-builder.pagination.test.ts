import { QueryBuilder } from '../query-builder';
import { setupTestBuilder, TestSchema } from './test-utils.js';
import { PaginatedResult } from '../../types';

describe('QueryBuilder - Pagination', () => {
  let builder: QueryBuilder<TestSchema, TestSchema['test_table'], false, {}>;

  const createTestRecord = (id: number) => ({
    id: id as unknown as 'Int32',
    name: `Test ${id}` as unknown as 'String',
    price: 100.0 as unknown as 'Float64',
    created_at: new Date() as unknown as 'Date',
    category: 'test' as unknown as 'String',
    active: 1 as unknown as 'UInt8',
    created_by: 1 as unknown as 'Int32',
    updated_by: 1 as unknown as 'Int32',
    status: 'active' as unknown as 'String',
    brand: 'test' as unknown as 'String',
    total: 1 as unknown as 'Int32',
    priority: 'medium' as unknown as 'String'
  });

  beforeEach(() => {
    builder = setupTestBuilder();
  });

  describe('paginate', () => {
    it('should paginate results with cursor', async () => {
      const mockData = [1, 2, 3].map(createTestRecord);

      // Mock execute to return our test data
      jest.spyOn(builder, 'execute').mockResolvedValue(mockData);

      const result = await builder.paginate({
        pageSize: 2,
        orderBy: [{ column: 'id', direction: 'ASC' }]
      });

      expect(result.data).toHaveLength(2);
      expect(result.pageInfo.hasNextPage).toBe(true);
      expect(result.pageInfo.hasPreviousPage).toBe(false);
      expect(result.pageInfo.startCursor).toBeTruthy();
      expect(result.pageInfo.endCursor).toBeTruthy();
    });

    it('should handle forward pagination', async () => {
      const firstPage = [1, 2].map(createTestRecord);
      const secondPage = [createTestRecord(3)];

      const executeSpy = jest.spyOn(builder, 'execute');
      executeSpy.mockResolvedValueOnce(firstPage);
      executeSpy.mockResolvedValueOnce(secondPage);

      // Get first page
      const page1 = await builder.paginate({
        pageSize: 2,
        orderBy: [{ column: 'id', direction: 'ASC' }]
      });

      // Get second page using cursor
      const page2 = await builder.paginate({
        pageSize: 2,
        after: page1.pageInfo.endCursor,
        orderBy: [{ column: 'id', direction: 'ASC' }]
      });

      expect(page1.data).toHaveLength(2);
      expect(page2.data).toHaveLength(1);
      expect(page2.pageInfo.hasNextPage).toBe(false);
      expect(page2.pageInfo.hasPreviousPage).toBe(true);
    });
  });

  describe('helper methods', () => {
    it('should get first page', async () => {
      const mockData = [1, 2].map(createTestRecord);

      jest.spyOn(builder, 'execute').mockResolvedValue(mockData);

      const result = await builder.firstPage(2);
      expect(result.data).toHaveLength(2);
      expect(result.pageInfo.hasNextPage).toBe(false);
    });

    it('should iterate through all pages', async () => {
      const pages = [
        [1, 2, 3].map(createTestRecord),      // First page: returns 3 records (2 + 1 extra)
        [3, 4, 5].map(createTestRecord),      // Second page: returns 3 records (2 + 1 extra)
        [5].map(createTestRecord)             // Last page: returns 1 record
      ];

      let pageIndex = 0;
      jest.spyOn(builder, 'execute').mockImplementation(async () => {
        return pages[pageIndex++] || [];
      });

      const allResults: PaginatedResult<TestSchema['test_table']>[] = [];
      for await (const page of builder.iteratePages(2)) {
        allResults.push(page);
      }

      expect(allResults).toHaveLength(3);
      expect(allResults[0].data).toHaveLength(2);  // First page shows 2 records
      expect(allResults[1].data).toHaveLength(2);  // Second page shows 2 records
      expect(allResults[2].data).toHaveLength(1);  // Last page shows 1 record
    });
  });

  describe('edge cases', () => {
    it('should handle empty results', async () => {
      jest.spyOn(builder, 'execute').mockResolvedValue([]);

      const result = await builder.paginate({
        pageSize: 10,
        orderBy: [{ column: 'id', direction: 'ASC' }]
      });

      expect(result.data).toHaveLength(0);
      expect(result.pageInfo.hasNextPage).toBe(false);
      expect(result.pageInfo.hasPreviousPage).toBe(false);
      expect(result.pageInfo.startCursor).toBe('');
      expect(result.pageInfo.endCursor).toBe('');
    });

    it('should handle exactly pageSize results', async () => {
      const mockData = Array.from({ length: 10 }, (_, i) => createTestRecord(i + 1));

      jest.spyOn(builder, 'execute').mockResolvedValue(mockData);

      const result = await builder.paginate({
        pageSize: 10,
        orderBy: [{ column: 'id', direction: 'ASC' }]
      });

      expect(result.data).toHaveLength(10);
      expect(result.pageInfo.hasNextPage).toBe(false);
    });
  });
}); 