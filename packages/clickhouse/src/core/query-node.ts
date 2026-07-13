import type {
  ConditionValueNode,
  ExprNode,
  InsertQueryNode,
  QueryConfig,
  SelectQueryNode,
} from '../types/index.js';

function cloneConditionValue(value: ConditionValueNode): ConditionValueNode {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(item => Array.isArray(item) ? item.map(inner => ({ ...inner })) : { ...item }) as ConditionValueNode;
  }
  return { ...value };
}

export function cloneExprNode(expr?: ExprNode): ExprNode | undefined {
  if (!expr) return undefined;

  switch (expr.kind) {
    case 'condition':
      return { ...expr, value: cloneConditionValue(expr.value) };
    case 'raw':
      return {
        ...expr,
        parameters: expr.parameters.map(parameter => ({ ...parameter })),
      };
    case 'group':
      return {
        ...expr,
        expression: cloneExprNode(expr.expression),
      };
    case 'logical':
      return {
        ...expr,
        conditions: expr.conditions.map(condition => cloneExprNode(condition)!),
      };
    case 'sequence':
      return {
        ...expr,
        items: expr.items.map(item => ({
          ...item,
          expression: cloneExprNode(item.expression)!,
        })),
      };
    default:
      throw new Error(`Unsupported expression kind: ${String((expr as { kind?: string }).kind)}`);
  }
}

export function createSelectQueryNode<TOutput, TSchema>(
  config: QueryConfig<TOutput, TSchema> = {}
): SelectQueryNode<TOutput, TSchema> {
  return {
    kind: 'select-query',
    from: config.from ? { ...config.from } : undefined,
    select: config.select ? config.select.map(item => ({ ...item })) : undefined,
    arrayJoins: config.arrayJoins ? config.arrayJoins.map(item => ({ ...item })) : undefined,
    prewhere: cloneExprNode(config.prewhere),
    where: cloneExprNode(config.where),
    groupBy: config.groupBy ? config.groupBy.map(item => ({ ...item })) : undefined,
    withTotals: config.withTotals,
    having: config.having
      ? config.having.map(item => ({
        ...item,
        parameters: item.parameters?.map(parameter => ({ ...parameter })),
      }))
      : undefined,
    limitBy: config.limitBy
      ? {
        ...config.limitBy,
        by: [...config.limitBy.by],
      }
      : undefined,
    limit: config.limit,
    offset: config.offset,
    distinct: config.distinct,
    orderBy: config.orderBy ? config.orderBy.map(item => ({ ...item })) : undefined,
    joins: config.joins
      ? config.joins.map(item => ({ ...item, on: cloneExprNode(item.on) }))
      : undefined,
    ctes: config.ctes ? config.ctes.map(item => ({ ...item })) : undefined,
    unionQueries: config.unionQueries ? [...config.unionQueries] : undefined,
    settings: config.settings ? { ...config.settings } : undefined,
  };
}

export function cloneSelectQueryNode<TOutput, TSchema>(
  query: SelectQueryNode<TOutput, TSchema>
): SelectQueryNode<TOutput, TSchema> {
  return createSelectQueryNode(query);
}

export function createInsertQueryNode(
  config: Partial<Omit<InsertQueryNode, 'kind'>> = {}
): InsertQueryNode {
  return {
    kind: 'insert-query',
    rows: config.rows ? config.rows.map(row => cloneInsertValue(row)) : [],
    columns: config.columns ? [...config.columns] : undefined,
    settings: config.settings ? { ...config.settings } : undefined,
  };
}

function cloneInsertValue<T>(value: T): T {
  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }
  if (Array.isArray(value)) {
    return value.map(item => cloneInsertValue(item)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, cloneInsertValue(item)])
      ) as T;
    }
  }
  return value;
}

export function cloneInsertQueryNode(query: InsertQueryNode): InsertQueryNode {
  return createInsertQueryNode(query);
}

export type QueryNodeTransform<TOutput, TSchema> = (
  query: SelectQueryNode<TOutput, TSchema>
) => SelectQueryNode<TOutput, TSchema>;

export function transformSelectQueryNode<TOutput, TSchema>(
  query: SelectQueryNode<TOutput, TSchema>,
  transforms: ReadonlyArray<QueryNodeTransform<TOutput, TSchema>>
): SelectQueryNode<TOutput, TSchema> {
  return transforms.reduce(
    (current, transform) => transform(current),
    cloneSelectQueryNode(query),
  );
}
