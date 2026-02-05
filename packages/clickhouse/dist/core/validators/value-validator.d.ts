import { FilterOperator } from '../../types/index.js';
import { ColumnType } from '../../types/schema.js';
export declare class ValueValidator {
    static validateFilterValue(columnType: ColumnType, operator: FilterOperator, value: any, columnName: string): void;
    private static validateSingleValue;
}
//# sourceMappingURL=value-validator.d.ts.map