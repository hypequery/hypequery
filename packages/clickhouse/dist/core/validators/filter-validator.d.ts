import { FilterConditionInput } from '../../types/index.js';
import { ColumnType } from '../../types/schema.js';
export declare class FilterValidator {
    static validateFilterCondition<T = any>(condition: FilterConditionInput<T>, columnType?: ColumnType, options?: {
        allowNull?: boolean;
    }): void;
    static validateJoinedColumn(column: string): boolean;
}
//# sourceMappingURL=filter-validator.d.ts.map