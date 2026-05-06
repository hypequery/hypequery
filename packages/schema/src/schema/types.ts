import type { SQLExpression } from '../utils/sql-tag.js';

export type ClickHouseSqlExpression = string | SQLExpression;
export type ClickHouseDefaultInput = string | number | boolean | null | SQLExpression;

export interface ClickHouseSchemaAst {
  tables: ClickHouseTableDefinition[];
  materializedViews?: ClickHouseMaterializedViewDefinition[];
}

export interface ClickHouseSchemaDefinition {
  tables: ClickHouseTableDefinition[];
  materializedViews?: ClickHouseMaterializedViewDefinition[];
}

export interface ClickHouseTableDefinition {
  kind: 'table';
  name: string;
  columns: ClickHouseColumnDefinition[];
  engine: ClickHouseTableEngine;
  settings?: Record<string, string | number | boolean>;
}

export interface ClickHouseTableInputDefinition {
  columns: Record<string, ClickHouseColumnBuilderLike>;
  engine: ClickHouseTableEngine;
  settings?: Record<string, string | number | boolean>;
}

export interface ClickHouseColumnDefinition {
  name: string;
  type: ClickHouseColumnType;
  default?: ClickHouseColumnDefaultValue;
}

export interface ClickHouseColumnBuilderLike {
  build(name: string): ClickHouseColumnDefinition;
}

export type ClickHouseColumnDefaultValue =
  | ClickHouseLiteralDefaultValue
  | ClickHouseSqlDefaultValue;

export interface ClickHouseLiteralDefaultValue {
  kind: 'literal';
  value: string | number | boolean | null;
}

export interface ClickHouseSqlDefaultValue {
  kind: 'sql';
  value: ClickHouseSqlExpression;
}

export type ClickHouseColumnType =
  | ClickHouseNamedColumnType
  | ClickHouseNullableColumnType
  | ClickHouseLowCardinalityColumnType;

export interface ClickHouseNamedColumnType {
  kind: 'named';
  name: string;
  arguments?: Array<string | number>;
}

export interface ClickHouseNullableColumnType {
  kind: 'nullable';
  inner: ClickHouseColumnType;
}

export interface ClickHouseLowCardinalityColumnType {
  kind: 'low_cardinality';
  inner: ClickHouseColumnType;
}

export interface ClickHouseTableEngine {
  type: string;
  orderBy?: ClickHouseSqlExpression[];
  partitionBy?: ClickHouseSqlExpression;
  primaryKey?: ClickHouseSqlExpression[];
  sampleBy?: ClickHouseSqlExpression;
}

export interface ClickHouseMaterializedViewDefinition {
  kind: 'materialized_view';
  name: string;
  from: string;
  to?: string;
  select: ClickHouseSqlExpression;
}

export interface ClickHouseMaterializedViewInputDefinition {
  from: string | ClickHouseTableDefinition;
  to?: string | ClickHouseTableDefinition;
  select: ClickHouseSqlExpression;
}
