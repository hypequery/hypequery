import {
  ColumnType,
  FilterOperator,
  InferColumnType,
  OperatorValueMap,
  FilterConditionInput
} from '../types';
import { FilterValidator } from './validators/filter-validator';

export class CrossFilter<
  Schema extends { [tableName: string]: { [columnName: string]: ColumnType } } = any,
  TableName extends keyof Schema = Extract<keyof Schema, string>
> {
  private conditions: Array<FilterConditionInput<any, Schema, Schema[TableName]>> = [];

  // Optionally pass a schema to get full type-validation.
  constructor(private schema?: Schema) { }

  add<
    ColumnName extends Extract<keyof Schema[TableName], string>,
    Op extends FilterOperator
  >(condition: FilterConditionInput<
    OperatorValueMap<InferColumnType<Schema[TableName][ColumnName]>>[Op],
    Schema,
    Schema[TableName]
  >): this {
    if (this.schema) {
      const columnType = this.getColumnType(String(condition.column));
      this.validateValueType(columnType, condition.value, String(condition.column), condition.operator);
    }
    this.conditions.push(condition);
    return this;
  }

  addMultiple(conditions: Array<FilterConditionInput<OperatorValueMap<InferColumnType<ColumnType>>[FilterOperator]>>): this {
    this.conditions.push(...conditions);
    return this;
  }

  getConditions(): Array<FilterConditionInput<any, Schema, Schema[TableName]>> {
    return this.conditions;
  }

  // Look up a column's type given its name.
  // If no schema was provided, we default to 'String'
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

  // Validate an operator–value combination.
  // Re–uses similar logic to QueryBuilder's filter validation.
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
}