import { FilterValidator } from './validators/filter-validator.js';
/**
 * A type-safe filter builder supporting both simple conditions and complex nested groups.
 * @template Schema - The full database schema type
 * @template TableName - The specific table being filtered
 */
export class CrossFilter {
    // Root group holding filter conditions or nested groups, defaulting to an implicit AND.
    rootGroup;
    schema;
    targetTable;
    constructor(schema, tableName) {
        this.schema = schema;
        this.targetTable = tableName;
        this.rootGroup = { operator: 'AND', conditions: [] };
    }
    /**
     * Adds a single filter condition to the root group with an implicit AND conjunction.
     * Performs type-safe validation if a schema is provided.
     */
    add(condition) {
        if (this.schema) {
            const columnType = this.getColumnType(String(condition.column));
            this.validateValueType(columnType, condition.value, String(condition.column), condition.operator);
        }
        // Convert Date objects to ISO strings for ClickHouse
        let value = condition.value;
        if (Array.isArray(value)) {
            value = value.map(v => v instanceof Date ? v.toISOString() : v);
        }
        else if (value instanceof Date) {
            value = value.toISOString();
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
    addMultiple(conditions) {
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
    addGroup(groupConditions, operator) {
        if (this.schema) {
            this.validateGroup(groupConditions);
        }
        const group = {
            operator,
            conditions: groupConditions
        };
        this.rootGroup.conditions.push(group);
        return this;
    }
    /**
     * Returns the current filter tree representing all conditions and groups.
     */
    getConditions() {
        return this.rootGroup;
    }
    /**
     * Looks up a column's type from the schema.
     * Defaults to 'String' if no schema is provided.
     * @param column - The column name as a string.
     */
    getColumnType(column) {
        if (!this.schema) {
            return 'String';
        }
        const tables = this.targetTable ? [this.targetTable] : Object.keys(this.schema);
        for (const table of tables) {
            const tableSchema = this.schema[table];
            if (column in tableSchema) {
                const columnKey = column;
                return tableSchema[columnKey];
            }
        }
        throw new Error(`Column '${column}' not found in schema`);
    }
    /**
     * Validates the value of a filter condition against its expected column type.
     */
    validateValueType(columnType, value, columnName, operator) {
        FilterValidator.validateFilterCondition({ column: columnName, operator, value }, columnType, { allowNull: true } // CrossFilter allows null values
        );
    }
    /**
     * Recursively validates an array of filter conditions and nested groups.
     */
    validateGroup(conditions) {
        for (const condition of conditions) {
            if (this.isGroup(condition)) {
                // Recursively validate nested groups
                this.validateGroup(condition.conditions);
            }
            else {
                const columnType = this.getColumnType(String(condition.column));
                this.validateValueType(columnType, condition.value, String(condition.column), condition.operator);
            }
        }
    }
    /**
     * Type guard to check if an item is a FilterGroup.
     */
    isGroup(item) {
        return typeof item.conditions !== 'undefined';
    }
    /**
     * Creates a filter for top N records by a value column
     * @param valueColumn - The column to filter and order by
     * @param n - Number of records to return
     * @param orderBy - Sort direction, defaults to 'desc'
     */
    topN(valueColumn, n, orderBy = 'desc') {
        this.add({
            column: valueColumn,
            operator: 'gt',
            value: 0
        });
        // Store limit and order information in the root group's metadata
        this.rootGroup = {
            ...this.rootGroup,
            limit: n,
            orderBy: {
                column: valueColumn,
                direction: orderBy.toUpperCase()
            }
        };
        return this;
    }
}
