import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import { FilterOperator } from '../../types/index.js';
import { PredicateExpression } from '../utils/predicate-builder.js';

export class FilteringFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, keyof Schema, any, keyof Schema>
> {
  constructor(private builder: QueryBuilder<Schema, State>) { }

  addCondition(
    conjunction: 'AND' | 'OR',
    column: string | string[],
    operator: FilterOperator,
    value: any
  ) {
    const config = this.builder.getConfig();
    const where = config.where || [];
    const parameters = config.parameters || [];

    const columnString = Array.isArray(column)
      ? `(${column.map(String).join(', ')})`
      : String(column);

    where.push({
      column: columnString,
      operator,
      value,
      conjunction,
      type: 'condition'
    });

    if (operator === 'in' || operator === 'notIn' || operator === 'globalIn' || operator === 'globalNotIn') {
      if (!Array.isArray(value)) {
        throw new Error(`Expected an array for ${operator} operator, but got ${typeof value}`);
      }
      parameters.push(...value);
    }
    else if (operator === 'inTuple' || operator === 'globalInTuple') {
      if (!Array.isArray(value)) {
        throw new Error(`Expected an array of tuples for ${operator} operator, but got ${typeof value}`);
      }
      value.forEach((tuple: any[]) => {
        parameters.push(...tuple);
      });
    }
    else if (operator === 'inSubquery' || operator === 'globalInSubquery') {
      if (typeof value !== 'string') {
        throw new Error(`Expected a string (subquery) for ${operator} operator, but got ${typeof value}`);
      }
    }
    else if (operator === 'inTable' || operator === 'globalInTable') {
      if (typeof value !== 'string') {
        throw new Error(`Expected a string (table name) for ${operator} operator, but got ${typeof value}`);
      }
    }
    else if (operator === 'between') {
      parameters.push(value[0], value[1]);
    }
    else {
      parameters.push(value);
    }

    return {
      ...config,
      where,
      parameters
    };
  }

  addExpressionCondition(
    conjunction: 'AND' | 'OR',
    expression: PredicateExpression
  ) {
    const config = this.builder.getConfig();
    const where = config.where || [];
    const parameters = config.parameters || [];

    where.push({
      type: 'expression',
      expression: expression.sql,
      parameters: expression.parameters,
      conjunction
    });

    parameters.push(...expression.parameters);

    return {
      ...config,
      where,
      parameters
    };
  }

  startWhereGroup() {
    const config = this.builder.getConfig();
    const where = config.where || [];

    where.push({
      column: '',
      operator: 'eq',
      value: null,
      conjunction: 'AND',
      type: 'group-start'
    });

    return {
      ...config,
      where
    };
  }

  startOrWhereGroup() {
    const config = this.builder.getConfig();
    const where = config.where || [];

    where.push({
      column: '',
      operator: 'eq',
      value: null,
      conjunction: 'OR',
      type: 'group-start'
    });

    return {
      ...config,
      where
    };
  }

  endWhereGroup() {
    const config = this.builder.getConfig();
    const where = config.where || [];

    where.push({
      column: '',
      operator: 'eq',
      value: null,
      conjunction: 'AND',
      type: 'group-end'
    });

    return {
      ...config,
      where
    };
  }
}
