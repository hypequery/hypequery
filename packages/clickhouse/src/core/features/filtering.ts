import { QueryBuilder } from '../query-builder';
import { ColumnType, FilterOperator, TableColumn } from '../../types';

export class FilteringFeature<
  Schema extends { [tableName: string]: { [columnName: string]: ColumnType } },
  T,
  HasSelect extends boolean = false,
  Aggregations = {},
  OriginalT = T
> {
  constructor(private builder: QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT>) { }

  addCondition<K extends keyof OriginalT | TableColumn<Schema>>(
    conjunction: 'AND' | 'OR',
    column: K,
    operator: FilterOperator,
    value: any
  ) {
    const config = this.builder.getConfig();
    const where = config.where || [];
    const parameters = config.parameters || [];

    where.push({
      column: String(column),
      operator,
      value,
      conjunction,
      type: 'condition'
    });

    if (operator === 'in' || operator === 'notIn') {
      parameters.push(...value);
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