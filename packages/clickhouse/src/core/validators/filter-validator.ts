import { FilterConditionInput } from '../../types/index.js';
import { ColumnType } from '../../types/schema.js';
import { ValueValidator } from './value-validator.js';

export class FilterValidator {
  static validateFilterCondition<T = any>(
    condition: FilterConditionInput<T>,
    columnType?: ColumnType,
    options: { allowNull?: boolean } = {}
  ): void {
    const { column, operator, value } = condition;
    const columnName = String(column);

    // Validate value is not null/undefined unless explicitly allowed
    if (!options.allowNull && (value === null || value === undefined)) {
      throw new Error(`Filter value for column '${columnName}' cannot be null/undefined`);
    }

    // Skip type validation if no columnType provided (e.g., for joined columns)
    if (!columnType) return;

    // Delegate to value validator for type checking
    ValueValidator.validateFilterValue(columnType, operator, value, columnName);
  }

  static validateJoinedColumn(column: string): boolean {
    return column.includes('.');
  }
} 
