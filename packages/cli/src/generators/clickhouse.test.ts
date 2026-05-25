import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateClickHouseTypes, clickhouseToTsType } from './clickhouse.js';

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

describe('clickhouseToTsType', () => {
  it('renders tuple types positionally', () => {
    expect(
      clickhouseToTsType('Tuple(UInt32, LowCardinality(String), String, String, LowCardinality(String))')
    ).toBe('[number, string, string, string, string]');
    expect(
      clickhouseToTsType('Array(Tuple(UInt32, LowCardinality(String), String, String, LowCardinality(String)))')
    ).toBe('Array<[number, string, string, string, string]>');
  });

  it('handles nested tuple values inside maps and nullable wrappers', () => {
    expect(
      clickhouseToTsType('Map(String, Tuple(UInt64, Nullable(String)))')
    ).toBe('Record<string, [string, string | null]>');
    expect(
      clickhouseToTsType('LowCardinality(Nullable(String))')
    ).toBe('string | null');
    expect(
      clickhouseToTsType('Nullable(Array(Tuple(UInt32, String)))')
    ).toBe('Array<[number, string]> | null');
    expect(
      clickhouseToTsType('Map(String, Array(Tuple(UInt32, String)))')
    ).toBe('Record<string, Array<[number, string]>>');
  });

  it('maps common scalar ClickHouse types used by migration pull', () => {
    expect(clickhouseToTsType('Bool')).toBe('boolean');
    expect(clickhouseToTsType('Boolean')).toBe('boolean');
    expect(clickhouseToTsType('Date32')).toBe('string');
    expect(clickhouseToTsType("DateTime('UTC')")).toBe('string');
    expect(clickhouseToTsType("DateTime64(3, 'UTC')")).toBe('string');
    expect(clickhouseToTsType('IPv4')).toBe('string');
    expect(clickhouseToTsType('IPv6')).toBe('string');
    expect(clickhouseToTsType('JSON')).toBe('unknown');
    expect(clickhouseToTsType('FixedString(16)')).toBe('string');
    expect(clickhouseToTsType('Decimal(10, 2)')).toBe('number');
    expect(clickhouseToTsType("Enum8('a' = 1, 'b' = 2)")).toBe('string');
  });
});
