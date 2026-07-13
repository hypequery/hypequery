import { describe, it, expect } from 'vitest';
import { generateClientTemplate } from './client.js';

describe('generateClientTemplate', () => {
  it('defaults to the HTTP ClickHouse client driven by env vars', () => {
    const result = generateClientTemplate();

    expect(result).toContain("import { createQueryBuilder } from '@hypequery/clickhouse'");
    expect(result).toContain('process.env.CLICKHOUSE_URL');
    expect(result).not.toContain('chdbAdapter');
  });

  it('scaffolds the embedded chDB adapter with an on-disk session path', () => {
    const result = generateClientTemplate({ database: 'chdb', chdbPath: './analytics.chdb' });

    expect(result).toContain("import { Session } from 'chdb'");
    expect(result).toContain("import { chdbAdapter } from 'chdb/hypequery'");
    expect(result).toContain("new Session('./analytics.chdb')");
    expect(result).toContain('adapter: chdbAdapter({ session })');
    // Embedded scaffold reads nothing from the environment
    expect(result).not.toContain('process.env');
  });

  it('scaffolds an in-memory chDB session when no path is given', () => {
    const result = generateClientTemplate({ database: 'chdb' });

    expect(result).toContain('new Session()');
    expect(result).toContain('in-memory session');
  });
});
