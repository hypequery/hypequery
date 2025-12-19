import { FilterOperator } from '../../types/index.js';
import { ColumnType } from '../../types/schema.js';

export class ValueValidator {
  static validateFilterValue(
    columnType: ColumnType,
    operator: FilterOperator,
    value: any,
    columnName: string
  ): void {
    if (operator === 'in' || operator === 'notIn') {
      if (!Array.isArray(value)) {
        throw new Error(`Operator '${operator}' requires an array value`);
      }
      value.forEach((v) => this.validateSingleValue(columnType, v, columnName));
      return;
    }
    if (operator === 'between') {
      if (!Array.isArray(value) || value.length !== 2) {
        throw new Error(`Operator 'between' requires an array with exactly two values`);
      }
      value.forEach((v) => this.validateSingleValue(columnType, v, columnName));
      return;
    }
    if ((operator === 'like' || operator === 'notLike') && typeof value !== 'string') {
      throw new Error(`Operator '${operator}' requires a string value`);
    }
    this.validateSingleValue(columnType, value, columnName);
  }

  private static validateSingleValue(
    columnType: ColumnType,
    value: any,
    columnName: string
  ): void {
    if (value === null) return;
    switch (columnType) {
      case 'Date':
        if (!(value instanceof Date) && typeof value !== 'string') {
          throw new Error(`Invalid date value for column '${columnName}'`);
        }
        break;
      case 'Int32':
      case 'Int64':
      case 'Float64':
        if (typeof value !== 'number') {
          throw new Error(`Invalid numeric value for column '${columnName}'`);
        }
        break;
      case 'String':
        if (typeof value !== 'string') {
          throw new Error(`Invalid string value for column '${columnName}'`);
        }
        break;
      default:
        break;
    }
  }
} 
