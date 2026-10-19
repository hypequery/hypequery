import type { DatasetSqlDialectRules } from '../dataset-sql-dialect.js';
import type { SemanticExpression } from '../semantic-plan.js';
import type { DerivedMeasureDefinition } from '../types.js';

function expressionSql(
  dialect: DatasetSqlDialectRules,
  expression: SemanticExpression,
  uses: Readonly<Record<string, string>>,
  resolve: (name: string) => string,
): string {
  switch (expression.kind) {
    case 'ref': {
      if (!Object.hasOwn(uses, expression.name)) {
        throw new Error(`Formula references undeclared input "${expression.name}".`);
      }
      const measureName = uses[expression.name];
      return resolve(measureName);
    }
    case 'literal':
      return dialect.formulaLiteral(expression.value);
    case 'binary':
      return dialect.formulaBinary(
        expression.operator,
        expressionSql(dialect, expression.left, uses, resolve),
        expressionSql(dialect, expression.right, uses, resolve),
      );
    case 'function':
      return dialect.formulaFunction(expression.name, expression.args.map(arg => expressionSql(dialect, arg, uses, resolve)));
  }
}

export function derivedExpressionSql(
  dialect: DatasetSqlDialectRules,
  definition: DerivedMeasureDefinition,
  resolve: (name: string) => string = dialect.quoteIdentifier,
): string {
  const aliases = Object.fromEntries(Object.keys(definition.uses).map(alias => [alias, alias]));
  return expressionSql(dialect, definition.formula(aliases).expression, definition.uses, resolve);
}

export function derivedProjection(dialect: DatasetSqlDialectRules, name: string, definition: DerivedMeasureDefinition): string {
  return `${derivedExpressionSql(dialect, definition)} AS ${dialect.quoteIdentifier(name)}`;
}
