import { QueryBuilder } from '../query-builder.js';
import { ColumnType, FilterOperator, TableColumn } from '../../types/index.js';

export class FilteringFeature<
  Schema,
  T,
  HasSelect extends boolean = false,
  Aggregations = {},
  OriginalT = T
> {
  constructor(private builder: QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT>) { }

  addCondition<K extends keyof OriginalT | TableColumn<Schema>>(
    conjunction: 'AND' | 'OR',
    column: K | K[],
    operator: FilterOperator,
    value: any
  ) {
    const config = this.builder.getConfig();
    const where = config.where || [];
    const parameters = config.parameters || [];

    // Handle tuple columns
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

    // Handle different parameter types based on operator
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
      // No parameters
    }
    else if (operator === 'inTable' || operator === 'globalInTable') {
      if (typeof value !== 'string') {
        throw new Error(`Expected a string (table name) for ${operator} operator, but got ${typeof value}`);
      }
      // No parameters
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

  /**
   * Adds a group-start marker to start a parenthesized group of conditions with AND conjunction
   * @returns The updated query config
   */
  startWhereGroup() {
    const config = this.builder.getConfig();
    const where = config.where || [];

    where.push({
      column: '', // Not used for group markers
      operator: 'eq', // Not used for group markers
      value: null, // Not used for group markers
      conjunction: 'AND',
      type: 'group-start'
    });

    return {
      ...config,
      where
    };
  }

  /**
   * Adds a group-start marker to start a parenthesized group of conditions with OR conjunction
   * @returns The updated query config
   */
  startOrWhereGroup() {
    const config = this.builder.getConfig();
    const where = config.where || [];

    where.push({
      column: '', // Not used for group markers
      operator: 'eq', // Not used for group markers
      value: null, // Not used for group markers
      conjunction: 'OR',
      type: 'group-start'
    });

    return {
      ...config,
      where
    };
  }

  /**
   * Adds a group-end marker to end a parenthesized group of conditions
   * @returns The updated query config
   */
  endWhereGroup() {
    const config = this.builder.getConfig();
    const where = config.where || [];

    where.push({
      column: '', // Not used for group markers
      operator: 'eq', // Not used for group markers
      value: null, // Not used for group markers
      conjunction: 'AND', // Not relevant for end markers
      type: 'group-end'
    });

    return {
      ...config,
      where
    };
  }
} 