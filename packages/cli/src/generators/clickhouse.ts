import {
  clickhouseToTsType,
  generateTypes,
  type GenerateTypesOptions,
} from '@hypequery/clickhouse/cli';
import { getClickHouseClient } from '../utils/clickhouse-client.js';

export interface ClickHouseGeneratorOptions {
  outputPath: string;
  includeTables?: string[];
  excludeTables?: string[];
}

export { clickhouseToTsType };

export async function generateClickHouseTypes(options: ClickHouseGeneratorOptions) {
  const generatorOptions: GenerateTypesOptions = {
    client: getClickHouseClient(),
    generatedBy: 'hypequery',
    includeUsageExample: false,
    ...(options.includeTables ? { includeTables: options.includeTables } : {}),
    ...(options.excludeTables ? { excludeTables: options.excludeTables } : {}),
  };

  await generateTypes(options.outputPath, generatorOptions);
}
