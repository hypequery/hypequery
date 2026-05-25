import path from 'node:path';
import { defineSchema, type ClickHouseSchemaAst } from '@hypequery/schema';
import { loadModule } from './load-api.js';
import { isRecord } from './runtime-guards.js';

export async function loadMigrationSchema(schemaPath: string): Promise<ClickHouseSchemaAst> {
  const mod = await loadModule(schemaPath);
  const schema = mod.default ?? mod.schema;

  if (isClickHouseSchemaAst(schema)) {
    return defineSchema({
      tables: schema.tables,
      ...(schema.materializedViews !== undefined ? { materializedViews: schema.materializedViews } : {}),
    });
  }

  const relativePath = path.relative(process.cwd(), path.resolve(process.cwd(), schemaPath));
  const availableExports = Object.keys(mod).filter(key => key !== '__esModule');
  throw new Error(
    `Invalid schema module: ${relativePath}\n\n` +
    `The module must export a defineSchema() result as the default export or as "schema".` +
    (availableExports.length > 0 ? `\n\nFound exports: ${availableExports.join(', ')}` : ''),
  );
}

function isClickHouseSchemaAst(value: unknown): value is ClickHouseSchemaAst {
  if (!isRecord(value) || !Array.isArray(value.tables)) {
    return false;
  }

  return value.materializedViews === undefined || Array.isArray(value.materializedViews);
}
