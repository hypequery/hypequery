import { ColumnType, FilterOperator, FilterConditionInput } from '../../types';
import { ValueValidator } from './value-validator';

export class FilterValidator {
  static validateFilterCondition<T = any>(
    condition: FilterConditionInput<T>,
    columnType?: ColumnType,
    options: { allowNull?: boolean } = {}
  ): void {
    const { column, operator, value } = condition;

    // Validate value is not null/undefined unless explicitly allowed
    if (!options.allowNull && (value === null || value === undefined)) {
      throw new Error(`Filter value for column '${String(column)}' cannot be null/undefined`);
    }

    // Skip type validation if no columnType provided (e.g., for joined columns)
    if (!columnType) return;

    // Delegate to value validator for type checking
    ValueValidator.validateFilterValue(columnType, operator, value, String(column));
  }

  static validateJoinedColumn(column: string): boolean {
    return column.includes('.');
  }
} 