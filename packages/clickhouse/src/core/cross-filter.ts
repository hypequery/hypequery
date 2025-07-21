import { FilterValidator } from './validators/filter-validator.js';
import { FilterConditionInput, FilterOperator, OperatorValueMap } from '../types/index.js';
import type { ColumnType, InferColumnType } from '../types/index.js';

// Define FilterGroup interface for nested filter groups
export interface FilterGroup<
  Schema extends Record<string, Record<string, any>> = any,
  OriginalT extends Record<string, any> = any
> {
  operator: 'AND' | 'OR';
  conditions: Array<
    FilterConditionInput<any, Schema, OriginalT> | FilterGroup<Schema, OriginalT>
  >;
  limit?: number;
  orderBy?: {
    column: keyof OriginalT;
    direction: 'ASC' | 'DESC';
  };
}

/**
 * A type-safe filter builder supporting both simple conditions and complex nested groups.
 * @template Schema - The full database schema type
 * @template TableName - The specific table being filtered
 */
export class CrossFilter<
  Schema extends { [tableName: string]: { [columnName: string]: ColumnType } } = any,
  TableName extends keyof Schema = Extract<keyof Schema, string>
> {
  // Root group holding filter conditions or nested groups, defaulting to an implicit AND.
  private rootGroup: FilterGroup<Schema, Schema[TableName]>;

  // Optionally pass a schema to get full type-validation.
  constructor(private schema?: Schema) {
    this.rootGroup = { operator: 'AND', conditions: [] };
  }

  /**
   * Adds a single filter condition to the root group with an implicit AND conjunction.
   * Performs type-safe validation if a schema is provided.
   */
  add<
    ColumnName extends Extract<keyof Schema[TableName], string>,
    Op extends FilterOperator
  >(
    condition: FilterConditionInput<
      OperatorValueMap<InferColumnType<Schema[TableName][ColumnName]>>[Op],
      Schema,
      Schema[TableName]
    >
  ): this {
    if (this.schema) {
      const columnType = this.getColumnType(String(condition.column));
      this.validateValueType(
        columnType,
        condition.value,
        String(condition.column),
        condition.operator
      );
    }

    // Convert Date objects to ISO strings for ClickHouse
    let value = condition.value;
    if (Array.isArray(value)) {
      value = value.map(v => v instanceof Date ? v.toISOString() : v) as typeof value;
    } else if (value instanceof Date) {
      value = value.toISOString() as typeof value;
    }

    this.rootGroup.conditions.push({
      ...condition,
      value
    });
    return this;
  }

  /**
   * Adds multiple filter conditions to the root group.
   */
  addMultiple(
    conditions: Array<FilterConditionInput<any, Schema, Schema[TableName]>>
  ): this {
    if (this.schema) {
      this.validateGroup(conditions);
    }
    this.rootGroup.conditions.push(...conditions);
    return this;
  }

  /**
   * Adds a nested group of filter conditions to the root group using the specified logical operator.
   * @param groupConditions - Array of filter conditions or nested groups to be grouped together.
   * @param operator - Logical operator ('AND' or 'OR') to combine the conditions in the group.
   */
  addGroup(
    groupConditions: Array<
      FilterConditionInput<any, Schema, Schema[TableName]> | FilterGroup<Schema, Schema[TableName]>
    >,
    operator: 'AND' | 'OR'
  ): this {
    if (this.schema) {
      this.validateGroup(groupConditions);
    }
    const group: FilterGroup<Schema, Schema[TableName]> = {
      operator,
      conditions: groupConditions
    };
    this.rootGroup.conditions.push(group);
    return this;
  }

  /**
   * Returns the current filter tree representing all conditions and groups.
   */
  getConditions(): FilterGroup<Schema, Schema[TableName]> {
    return this.rootGroup;
  }

  /**
   * Looks up a column's type from the schema.
   * Defaults to 'String' if no schema is provided.
   * @param column - The column name as a string.
   */
  private getColumnType(column: string): ColumnType {
    if (!this.schema) {
      return 'String';
    }
    for (const table in this.schema) {
      const tableSchema = this.schema[table];
      if (column in tableSchema) {
        return tableSchema[column];
      }
    }
    throw new Error(`Column '${column}' not found in schema`);
  }

  /**
   * Validates the value of a filter condition against its expected column type.
   */
  private validateValueType(
    columnType: ColumnType,
    value: any,
    columnName: string,
    operator: FilterOperator
  ): void {
    FilterValidator.validateFilterCondition(
      { column: columnName, operator, value },
      columnType,
      { allowNull: true }  // CrossFilter allows null values
    );
  }

  /**
   * Recursively validates an array of filter conditions and nested groups.
   */
  private validateGroup(
    conditions: Array<
      FilterConditionInput<any, Schema, Schema[TableName]> | FilterGroup<Schema, Schema[TableName]>
    >
  ): void {
    for (const condition of conditions) {
      if (this.isGroup(condition)) {
        // Recursively validate nested groups
        this.validateGroup(condition.conditions);
      } else {
        const columnType = this.getColumnType(String(condition.column));
        this.validateValueType(
          columnType,
          condition.value,
          String(condition.column),
          condition.operator
        );
      }
    }
  }

  /**
   * Type guard to check if an item is a FilterGroup.
   */
  private isGroup(
    item: FilterConditionInput<any, Schema, Schema[TableName]> | FilterGroup<Schema, Schema[TableName]>
  ): item is FilterGroup<Schema, Schema[TableName]> {
    return typeof (item as any).conditions !== 'undefined';
  }

  /**
   * Creates a filter for top N records by a value column
   * @param valueColumn - The column to filter and order by
   * @param n - Number of records to return
   * @param orderBy - Sort direction, defaults to 'desc'
   */
  topN<K extends keyof Schema[TableName]>(
    valueColumn: K,
    n: number,
    orderBy: 'desc' | 'asc' = 'desc'
  ): this {
    this.add({
      column: valueColumn,
      operator: 'gt',
      value: 0
    } as FilterConditionInput<any, Schema, Schema[TableName]>);

    // Store limit and order information in the root group's metadata
    this.rootGroup = {
      ...this.rootGroup,
      limit: n,
      orderBy: {
        column: valueColumn,
        direction: orderBy.toUpperCase() as 'ASC' | 'DESC'
      }
    };

    return this;
  }
}