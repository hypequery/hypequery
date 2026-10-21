import type { DatasetSqlDialectRules } from '../dataset-sql-dialect.js';
import type { SemanticExpression } from '../semantic-plan.js';
import type { DerivedMeasureDefinition } from '../types.js';

/**
 * Render a formula through the dialect. `resolveRef` maps each formula input
 * to the SQL that reads it, and rejects inputs the formula did not declare.
 * The one formula renderer for derived measures and derived metrics.
 */
export function formulaExpressionSql(
  dialect: DatasetSqlDialectRules,
  expression: SemanticExpression,
  resolveRef: (name: string) => string,
): string {
  switch (expression.kind) {
    case 'ref':
      return resolveRef(expression.name);
    case 'literal':
      return dialect.formulaLiteral(expression.value);
    case 'binary':
      return dialect.formulaBinary(
        expression.operator,
        formulaExpressionSql(dialect, expression.left, resolveRef),
        formulaExpressionSql(dialect, expression.right, resolveRef),
      );
    case 'function':
      return dialect.formulaFunction(expression.name, expression.args.map(arg => formulaExpressionSql(dialect, arg, resolveRef)));
  }
}

export function derivedExpressionSql(
  dialect: DatasetSqlDialectRules,
  definition: DerivedMeasureDefinition,
  resolve: (name: string) => string = dialect.quoteIdentifier,
): string {
  const aliases = Object.fromEntries(Object.keys(definition.uses).map(alias => [alias, alias]));
  return formulaExpressionSql(dialect, definition.formula(aliases).expression, name => {
    if (!Object.hasOwn(definition.uses, name)) {
      throw new Error(`Formula references undeclared input "${name}".`);
    }
    return resolve(definition.uses[name]);
  });
}

export function derivedProjection(dialect: DatasetSqlDialectRules, name: string, definition: DerivedMeasureDefinition): string {
  return `${derivedExpressionSql(dialect, definition)} AS ${dialect.quoteIdentifier(name)}`;
}
