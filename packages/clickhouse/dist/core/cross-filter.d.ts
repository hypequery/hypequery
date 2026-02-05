import { FilterConditionInput, FilterOperator, OperatorValueMap } from '../types/index.js';
import type { ColumnType, InferColumnType } from '../types/schema.js';
import type { SchemaDefinition } from './types/builder-state.js';
type GenericSchema = Record<string, Record<string, ColumnType>>;
type GenericSchemaDefinition = SchemaDefinition<GenericSchema>;
export interface FilterGroup<Schema extends SchemaDefinition<Schema> = GenericSchemaDefinition, OriginalT extends Record<string, any> = Record<string, any>> {
    operator: 'AND' | 'OR';
    conditions: Array<FilterConditionInput<any, Schema, OriginalT> | FilterGroup<Schema, OriginalT>>;
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
export declare class CrossFilter<Schema extends SchemaDefinition<Schema> = GenericSchemaDefinition, TableName extends keyof Schema & string = Extract<keyof Schema, string>> {
    private rootGroup;
    private schema?;
    private targetTable?;
    constructor();
    constructor(schema: Schema);
    constructor(schema: Schema, tableName: TableName);
    /**
     * Adds a single filter condition to the root group with an implicit AND conjunction.
     * Performs type-safe validation if a schema is provided.
     */
    add<ColumnName extends Extract<keyof Schema[TableName], string>, Op extends FilterOperator>(condition: FilterConditionInput<OperatorValueMap<InferColumnType<Schema[TableName][ColumnName]>>[Op], Schema, Schema[TableName]>): this;
    /**
     * Adds multiple filter conditions to the root group.
     */
    addMultiple(conditions: Array<FilterConditionInput<any, Schema, Schema[TableName]>>): this;
    /**
     * Adds a nested group of filter conditions to the root group using the specified logical operator.
     * @param groupConditions - Array of filter conditions or nested groups to be grouped together.
     * @param operator - Logical operator ('AND' or 'OR') to combine the conditions in the group.
     */
    addGroup(groupConditions: Array<FilterConditionInput<any, Schema, Schema[TableName]> | FilterGroup<Schema, Schema[TableName]>>, operator: 'AND' | 'OR'): this;
    /**
     * Returns the current filter tree representing all conditions and groups.
     */
    getConditions(): FilterGroup<Schema, Schema[TableName]>;
    /**
     * Looks up a column's type from the schema.
     * Defaults to 'String' if no schema is provided.
     * @param column - The column name as a string.
     */
    private getColumnType;
    /**
     * Validates the value of a filter condition against its expected column type.
     */
    private validateValueType;
    /**
     * Recursively validates an array of filter conditions and nested groups.
     */
    private validateGroup;
    /**
     * Type guard to check if an item is a FilterGroup.
     */
    private isGroup;
    /**
     * Creates a filter for top N records by a value column
     * @param valueColumn - The column to filter and order by
     * @param n - Number of records to return
     * @param orderBy - Sort direction, defaults to 'desc'
     */
    topN<K extends keyof Schema[TableName]>(valueColumn: K, n: number, orderBy?: 'desc' | 'asc'): this;
}
export {};
//# sourceMappingURL=cross-filter.d.ts.map