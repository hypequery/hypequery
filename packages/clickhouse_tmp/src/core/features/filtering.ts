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
      conjunction
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
} 