import type { SQLExpression } from '../../dataset/sql-tag.js';

export type ClickHouseSqlExpression = string | SQLExpression;

export interface ClickHouseSchemaAst {
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

export interface ClickHouseColumnDefinition {
  name: string;
  type: ClickHouseColumnType;
  default?: ClickHouseSqlExpression;
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
