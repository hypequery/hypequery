/**
 * SQL rendering owned by the semantic datasets layer, separate from a query
 * builder's compiler dialect. Extend this contract as emission sites migrate.
 * Only the ClickHouse implementation is supported today.
 */
export interface DatasetSqlDialect {
  readonly name: string;
  /** Quote one output identifier; dots in a qualified semantic alias are literal. */
  quoteIdentifier(identifier: string): string;
}
