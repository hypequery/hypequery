import type { DatabaseAdapter } from './adapters/database-adapter.js';
import type { QueryRuntimeContext } from './cache/runtime-context.js';
import type { SqlDialect } from './dialects/sql-dialect.js';
import type { CteBody } from './features/analytics.js';
import { QueryBuilder } from './query-builder.js';
import type {
  AnyBuilderState,
  CteShapes,
  CteSourceState,
  InitialState,
  RegisterCte,
  SchemaDefinition,
  WithCtes,
} from './types/builder-state.js';
import type { ColumnType } from '../types/schema.js';
import type { RawCteBody } from '../types/index.js';
import { createCteScopeState, type CteScopeRuntimeState } from './utils/cte-scope-state.js';

/** One CTE declared on a scope, replayed onto every query the scope starts. */
type CteDeclaration = {
  alias: string;
  columns?: Record<string, ColumnType>;
} & (
  | { recursive: true; body: string | RawCteBody }
  | { recursive: false; body: CteBody }
);

/** Derive the next registry from the declaration itself, including builder output. */
type DeclaredCtes<Ctes extends CteShapes, Declaration extends CteDeclaration> =
  Declaration['body'] extends QueryBuilder<any, infer BodyState>
    ? RegisterCte<Ctes, Declaration['alias'], BodyState['output']>
    : [NonNullable<Declaration['columns']>] extends [never]
      ? Ctes
      : RegisterCte<Ctes, Declaration['alias'], NonNullable<Declaration['columns']>>;

/** What a scope needs to build a query, mirroring `createQueryBuilder`. */
export interface CteScopeDeps {
  runtime: QueryRuntimeContext;
  adapter: DatabaseAdapter;
  dialect: SqlDialect;
}

/**
 * CTEs declared before a query has a source, so the query can read *from* one
 * of them. `db.table('users').withCTE(...)` covers the case where the CTE is
 * joined into a query over a schema table; a scope covers the case where the
 * CTE is the source, which a table-first chain cannot express.
 *
 * Declarations are scoped to the queries a scope starts. Nothing is added to
 * the schema.
 */
export class CteScope<Schema extends SchemaDefinition<Schema>, Ctes extends CteShapes = {}> {
  constructor(
    private readonly deps: CteScopeDeps,
    private readonly declarations: readonly CteDeclaration[] = [],
  ) { }

  /**
   * Declares a CTE. Columns declared alongside a raw body type the alias the
   * same way a builder body's output type does.
   */
  withCTE<Alias extends string, SubqueryState extends AnyBuilderState>(
    alias: Alias,
    subquery: QueryBuilder<any, SubqueryState>
  ): CteScope<Schema, RegisterCte<Ctes, Alias, SubqueryState['output']>>;
  withCTE<Alias extends string, Columns extends Record<string, ColumnType>>(
    alias: Alias,
    sql: string | RawCteBody,
    columns: Columns
  ): CteScope<Schema, RegisterCte<Ctes, Alias, Columns>>;
  withCTE(alias: string, sql: string | RawCteBody): CteScope<Schema, Ctes>;
  withCTE<
    Alias extends string,
    Body extends CteBody,
    Columns extends Record<string, ColumnType> | undefined = undefined
  >(
    alias: Alias,
    body: Body,
    columns?: Columns
  ) {
    return this.declare({ alias, body, columns, recursive: false });
  }

  /**
   * Declares a recursive CTE, rendering the clause as `WITH RECURSIVE`. The
   * body must be raw SQL: its recursive term references the CTE's own alias,
   * which no builder can express.
   *
   * ClickHouse requires `enable_analyzer` (on by default from 24.8), a
   * `UNION ALL` between the seed and the recursive term, and stops at
   * `max_recursive_cte_evaluation_depth` (1000 by default).
   *
   * @example
   * ```ts
   * const rows = await db
   *   .withRecursiveCTE(
   *     'descendants',
   *     {
   *       sql: `
   *         SELECT {rootId:UUID} AS id
   *         UNION ALL
   *         SELECT link.child_id AS id
   *         FROM asset_link AS link
   *         INNER JOIN descendants AS walked ON link.parent_id = walked.id
   *         WHERE link.organization_id = {organizationId:UUID}
   *       `,
   *       parameters: { rootId, organizationId },
   *     },
   *     { id: 'UUID' },
   *   )
   *   .table('descendants')
   *   .select(['id'])
   *   .distinct()
   *   .execute();
   * ```
   */
  withRecursiveCTE<Alias extends string, Columns extends Record<string, ColumnType>>(
    alias: Alias,
    body: string | RawCteBody,
    columns: Columns
  ): CteScope<Schema, RegisterCte<Ctes, Alias, Columns>>;
  withRecursiveCTE(alias: string, body: string | RawCteBody): CteScope<Schema, Ctes>;
  withRecursiveCTE<
    Alias extends string,
    Body extends string | RawCteBody,
    Columns extends Record<string, ColumnType> | undefined = undefined
  >(
    alias: Alias,
    body: Body,
    columns?: Columns
  ) {
    return this.declare({ alias, body, columns, recursive: true });
  }

  /**
   * Starts a query, reading either from a declared CTE or from a schema table.
   * Either way the query carries every CTE declared on this scope, so the rest
   * of them stay available as join targets.
   */
  table<Alias extends Extract<keyof Ctes, string>>(
    alias: Alias
  ): QueryBuilder<Schema, CteSourceState<Schema, Alias, Ctes>>;
  table<TableName extends Extract<keyof Schema, string>>(
    tableName: TableName
  ): QueryBuilder<Schema, WithCtes<InitialState<Schema, TableName>, Ctes>>;
  // QueryBuilder is invariant in State. Only this overload boundary erases it;
  // the replay loop below uses a concrete state, and callers see the overloads.
  table(name: string): QueryBuilder<Schema, any> {
    const cte = this.declarations.some(entry => entry.alias === name);
    let builder = new QueryBuilder<Schema, CteScopeRuntimeState<Schema>>(
      name,
      createCteScopeState<Schema>(name),
      this.deps.runtime,
      this.deps.adapter,
      this.deps.dialect,
      cte ? { kind: 'table', name, cte: true } : undefined,
    );

    // Keep replay on the builder's own paths. Narrow raw vs builder bodies so
    // each call satisfies the public overloads without erasing the builder.
    for (const entry of this.declarations) {
      if (entry.recursive) {
        builder = entry.columns
          ? builder.withRecursiveCTE(entry.alias, entry.body, entry.columns)
          : builder.withRecursiveCTE(entry.alias, entry.body);
      } else if (entry.body instanceof QueryBuilder) {
        builder = builder.withCTE(entry.alias, entry.body);
      } else {
        builder = entry.columns
          ? builder.withCTE(entry.alias, entry.body, entry.columns)
          : builder.withCTE(entry.alias, entry.body);
      }
    }
    return builder;
  }

  private declare<Declaration extends CteDeclaration>(declaration: Declaration): CteScope<Schema, DeclaredCtes<Ctes, Declaration>> {
    return new CteScope<Schema, DeclaredCtes<Ctes, Declaration>>(this.deps, [...this.declarations, declaration]);
  }
}
