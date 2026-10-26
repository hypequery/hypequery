import type { PostgresDriver, PostgresQueryOptions } from './driver/driver.js';
import type { PlaceholderWriter, PostgresSelectNode } from './types.js';
import { compileSelect } from './compiler/compile-select.js';
import { AggregationFeature } from './features/aggregations.js';
import { compileWithNumberedPlaceholders, ExecutorFeature, type CompiledPostgresStatement } from './features/executor.js';
import { FilteringFeature } from './features/filtering.js';
import { JoinFeature, type JoinConditionInput, type JoinKeyPairs } from './features/joins.js';
import { QueryModifiersFeature } from './features/query-modifiers.js';

export interface PostgresBuilderState {
  readonly node: PostgresSelectNode;
  readonly driver?: PostgresDriver;
}

/**
 * An immutable Postgres SELECT builder implementing the datasets
 * `QueryBuilderLike` protocol. State is a query node; each method delegates
 * to a feature that returns a new node, and the builder wraps it.
 *
 * Column and alias arguments are SQL text exactly as the datasets planner
 * spells it (aliases arrive quoted); values are always bound as `$n`.
 */
export class PostgresQueryBuilder {
  private readonly aggregations: AggregationFeature;
  private readonly filtering: FilteringFeature;
  private readonly joins: JoinFeature;
  private readonly modifiers: QueryModifiersFeature;
  private readonly executor: ExecutorFeature;

  constructor(private readonly state: PostgresBuilderState) {
    const node = () => this.state.node;
    this.aggregations = new AggregationFeature(node);
    this.filtering = new FilteringFeature(node);
    this.joins = new JoinFeature(node);
    this.modifiers = new QueryModifiersFeature(node);
    this.executor = new ExecutorFeature(node, state.driver);
  }

  /** The current query node. */
  getQueryNode(): PostgresSelectNode {
    return this.state.node;
  }

  select(columns: string[] | string): PostgresQueryBuilder {
    return this.with(this.modifiers.select(columns));
  }

  sum(column: string, alias?: string): PostgresQueryBuilder {
    return this.with(this.aggregations.sum(column, alias));
  }

  count(column: string, alias?: string): PostgresQueryBuilder {
    return this.with(this.aggregations.count(column, alias));
  }

  countDistinct(column: string, alias?: string): PostgresQueryBuilder {
    return this.with(this.aggregations.countDistinct(column, alias));
  }

  avg(column: string, alias?: string): PostgresQueryBuilder {
    return this.with(this.aggregations.avg(column, alias));
  }

  min(column: string, alias?: string): PostgresQueryBuilder {
    return this.with(this.aggregations.min(column, alias));
  }

  max(column: string, alias?: string): PostgresQueryBuilder {
    return this.with(this.aggregations.max(column, alias));
  }

  argMax(column: string, argColumn: string, alias?: string): PostgresQueryBuilder {
    return this.with(this.aggregations.argMax(column, argColumn, alias));
  }

  argMin(column: string, argColumn: string, alias?: string): PostgresQueryBuilder {
    return this.with(this.aggregations.argMin(column, argColumn, alias));
  }

  quantile(column: string, level: number, alias?: string): PostgresQueryBuilder {
    return this.with(this.aggregations.quantile(column, level, alias));
  }

  stddev(column: string, alias?: string): PostgresQueryBuilder {
    return this.with(this.aggregations.stddev(column, alias));
  }

  variance(column: string, alias?: string): PostgresQueryBuilder {
    return this.with(this.aggregations.variance(column, alias));
  }

  approxCountDistinct(column: string, alias?: string): PostgresQueryBuilder {
    return this.with(this.aggregations.approxCountDistinct(column, alias));
  }

  where(column: string, operator: string, value: unknown): PostgresQueryBuilder {
    return this.with(this.filtering.where(column, operator, value));
  }

  leftJoin(
    table: string,
    leftColumn: string,
    rightColumn: string,
    alias?: string,
    on?: JoinConditionInput | JoinConditionInput[],
  ): PostgresQueryBuilder {
    return this.with(this.joins.leftJoin(table, leftColumn, rightColumn, alias, on));
  }

  /** Single-match LEFT JOIN (ClickHouse `LEFT ANY JOIN`), as `LEFT JOIN LATERAL (… LIMIT 1)`. */
  leftAnyJoin(
    table: string,
    leftColumn: string,
    rightColumn: string,
    alias?: string,
    on?: JoinConditionInput | JoinConditionInput[],
  ): PostgresQueryBuilder;
  leftAnyJoin(
    table: string,
    keys: JoinKeyPairs,
    alias?: string,
    on?: JoinConditionInput | JoinConditionInput[],
  ): PostgresQueryBuilder;
  leftAnyJoin(
    table: string,
    leftOrKeys: string | JoinKeyPairs,
    rightOrAlias?: string,
    aliasOrOn?: string | JoinConditionInput | JoinConditionInput[],
    on?: JoinConditionInput | JoinConditionInput[],
  ): PostgresQueryBuilder {
    return this.with(this.joins.leftAnyJoin(table, leftOrKeys, rightOrAlias, aliasOrOn, on));
  }

  groupBy(columns: string | string[]): PostgresQueryBuilder {
    return this.with(this.modifiers.groupBy(columns));
  }

  orderBy(column: string, direction?: 'ASC' | 'DESC'): PostgresQueryBuilder {
    return this.with(this.modifiers.orderBy(column, direction));
  }

  limit(count: number): PostgresQueryBuilder {
    return this.with(this.modifiers.limit(count));
  }

  offset(count: number): PostgresQueryBuilder {
    return this.with(this.modifiers.offset(count));
  }

  /** SQL with `$1`, `$2`, … and the values they bind. */
  toSQLWithParams(): CompiledPostgresStatement {
    return compileWithNumberedPlaceholders(this.state.node);
  }

  /** SQL with each value spelled by `placeholder`, called in text order. */
  toSQLWithPlaceholders(placeholder: PlaceholderWriter): string {
    return compileSelect(this.state.node, placeholder);
  }

  execute<T = Record<string, unknown>>(options?: PostgresQueryOptions): Promise<T[]> {
    return this.executor.execute<T>(options);
  }

  private with(node: PostgresSelectNode): PostgresQueryBuilder {
    return new PostgresQueryBuilder({ ...this.state, node });
  }
}
