import { generateTypes, type GenerateTypesOptions } from '@hypequery/clickhouse/cli';
import { getChdbTypeGenerationClient } from '../utils/chdb-client.js';

export interface ChdbGeneratorOptions {
  outputPath: string;
  includeTables?: string[];
  excludeTables?: string[];
  chdbPath?: string;
}

/**
 * Same generator as ClickHouse — the introspection SQL (SHOW TABLES,
 * DESCRIBE TABLE) is identical on the embedded engine — but the client seam
 * is backed by a chDB session instead of an HTTP connection.
 */
export async function generateChdbTypes(options: ChdbGeneratorOptions) {
  const generatorOptions: GenerateTypesOptions = {
    client: getChdbTypeGenerationClient(options.chdbPath),
    generatedBy: 'hypequery',
    includeUsageExample: false,
    ...(options.includeTables ? { includeTables: options.includeTables } : {}),
    ...(options.excludeTables ? { excludeTables: options.excludeTables } : {}),
  };

  await generateTypes(options.outputPath, generatorOptions);
}
