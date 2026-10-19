import {
  clickhouseToTsType,
  generateTypes,
  type GenerateTypesOptions,
} from '../typegen/index.js';
import { getClickHouseClient } from '../utils/clickhouse-client.js';

export interface ClickHouseGeneratorOptions {
  outputPath: string;
  includeTables?: string[];
  excludeTables?: string[];
  onColumn?: GenerateTypesOptions['onColumn'];
  onUnsupportedType?: GenerateTypesOptions['onUnsupportedType'];
}

export { clickhouseToTsType };

export async function generateClickHouseTypes(options: ClickHouseGeneratorOptions) {
  const generatorOptions: GenerateTypesOptions = {
    client: getClickHouseClient(),
    generatedBy: 'hypequery',
    includeUsageExample: false,
    ...(options.onColumn ? { onColumn: options.onColumn } : {}),
    ...(options.onUnsupportedType ? { onUnsupportedType: options.onUnsupportedType } : {}),
    ...(options.includeTables ? { includeTables: options.includeTables } : {}),
    ...(options.excludeTables ? { excludeTables: options.excludeTables } : {}),
  };

  return generateTypes(options.outputPath, generatorOptions);
}
