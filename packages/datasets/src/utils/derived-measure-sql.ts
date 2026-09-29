import type { SemanticExpression } from '../semantic-plan.js';
import type { DerivedMeasureDefinition } from '../types.js';
import { quoteSQLIdentifier } from '../sql-utils.js';

function expressionSql(expression: SemanticExpression, uses: Readonly<Record<string, string>>, resolve: (name: string) => string): string {
  switch (expression.kind) {
    case 'ref': {
      if (!Object.hasOwn(uses, expression.name)) {
        throw new Error(`Formula references undeclared input "${expression.name}".`);
      }
      const measureName = uses[expression.name];
      return resolve(measureName);
    }
    case 'literal': {
      if (expression.value === null) return 'NULL';
      if (typeof expression.value === 'number') {
        if (!Number.isFinite(expression.value)) throw new Error('Formula contains a non-finite number.');
        return String(expression.value);
      }
      if (typeof expression.value === 'boolean') return expression.value ? 'true' : 'false';
      return `'${expression.value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
    }
    case 'binary': {
      const operators = { add: '+', subtract: '-', multiply: '*', divide: '/' } as const;
      const operator = operators[expression.operator];
      if (!operator) throw new Error('Formula contains an unsupported binary operator.');
      return `(${expressionSql(expression.left, uses, resolve)} ${operator} ${expressionSql(expression.right, uses, resolve)})`;
    }
    case 'function': {
      const args = expression.args.map(arg => expressionSql(arg, uses, resolve));
      switch (expression.name) {
        case 'nullIfZero': return `NULLIF(${args[0]}, 0)`;
        case 'coalesce': return `COALESCE(${args.join(', ')})`;
        case 'round': return `ROUND(${args.join(', ')})`;
        case 'floor': return `FLOOR(${args[0]})`;
        case 'ceil': return `CEIL(${args[0]})`;
        default: throw new Error('Formula contains an unsupported function.');
      }
    }
  }
}

export function derivedExpressionSql(definition: DerivedMeasureDefinition, resolve: (name: string) => string = quoteSQLIdentifier): string {
  const aliases = Object.fromEntries(Object.keys(definition.uses).map(alias => [alias, alias]));
  return expressionSql(definition.formula(aliases).expression, definition.uses, resolve);
}

export function derivedProjection(name: string, definition: DerivedMeasureDefinition): string {
  return `${derivedExpressionSql(definition)} AS ${quoteSQLIdentifier(name)}`;
}
