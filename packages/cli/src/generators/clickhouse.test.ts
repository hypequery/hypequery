import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateClickHouseTypes } from './clickhouse.js';

const generateTypes = vi.hoisted(() => vi.fn());
vi.mock('@hypequery/clickhouse/cli', () => ({
  clickhouseToTsType: vi.fn(),
  generateTypes,
}));

const mockClient = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../utils/clickhouse-client.js', () => ({
  getClickHouseClient: () => mockClient,
}));

describe('generateClickHouseTypes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateTypes.mockResolvedValue(undefined);
  });

  it('delegates ClickHouse type generation to the shared package implementation', async () => {
    await generateClickHouseTypes({
      outputPath: 'analytics/schema.ts',
      includeTables: ['users'],
      excludeTables: ['events'],
    });

    expect(generateTypes).toHaveBeenCalledWith('analytics/schema.ts', {
      client: mockClient,
      generatedBy: 'hypequery',
      includeUsageExample: false,
      includeTables: ['users'],
      excludeTables: ['events'],
    });
  });
});
