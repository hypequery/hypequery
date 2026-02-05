import { QueryConfig } from '../../types/index.js';
export declare class SQLFormatter {
    formatSelect(config: QueryConfig<any, any>): string;
    formatGroupBy(config: QueryConfig<any, any>): string;
    formatWhere(config: QueryConfig<any, any>): string;
    private getSqlOperator;
    formatJoins(config: QueryConfig<any, any>): string;
}
//# sourceMappingURL=sql-formatter.d.ts.map