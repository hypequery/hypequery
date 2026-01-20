import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateClickHouseTypes } from './clickhouse.js';

const mkdir = vi.hoisted(() => vi.fn());
const writeFile = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', () => ({
  default: { mkdir, writeFile },
  mkdir,
  writeFile,
}));

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../utils/clickhouse-client.js', () => ({
  getClickHouseClient: () => ({ query: mockQuery }),
}));

describe('generateClickHouseTypes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mkdir.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);
    mockQuery.mockReset();
  });

  it('writes schema and record interfaces', async () => {
    const tableResponse = { json: vi.fn().mockResolvedValue([{ name: 'users' }]) };
    const columnsResponse = {
      json: vi.fn().mockResolvedValue([
        { name: 'id', type: 'Int32' },
        { name: 'name', type: 'String' },
      ]),
    };

    mockQuery
      .mockResolvedValueOnce(tableResponse)
      .mockResolvedValueOnce(columnsResponse)
      .mockResolvedValueOnce(columnsResponse);

    await generateClickHouseTypes({ outputPath: 'analytics/schema.ts' });

    expect(mkdir).toHaveBeenCalled();
    const [writtenPath, contents] = writeFile.mock.calls[0];
    expect(writtenPath).toContain('analytics/schema.ts');
    expect(contents).toContain('export interface IntrospectedSchema');
  });
});
