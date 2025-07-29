import { QueryBuilder } from '../query-builder.js';
import { ColumnType, JoinType, TableReference } from '../../types/index.js';

export class JoinFeature<
  Schema,
  T,
  HasSelect extends boolean = false,
  Aggregations = {},
  OriginalT = T
> {
  constructor(private builder: QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT>) { }

  /**
   * Adds a join with support for both same-database and cross-database tables
   * @param type - The join type (INNER, LEFT, RIGHT, FULL)
   * @param table - The table to join (can be 'table' or 'database.table')
   * @param leftColumn - The column from the current table
   * @param rightColumn - The column from the joined table (can be fully qualified)
   * @param alias - Optional alias for the joined table
   * @returns Updated query configuration
   */
  addJoin<TableName extends TableReference<Schema>>(
    type: JoinType,
    table: TableName,
    leftColumn: keyof OriginalT & string,
    rightColumn: string,
    alias?: string
  ) {
    const config = this.builder.getConfig();

    // Parse table name to detect cross-database references
    const { isCrossDatabase, fullTableName } = this.parseTableName(table);

    // Validate cross-database access if needed
    if (isCrossDatabase) {
      this.validateCrossDatabaseAccess(fullTableName);
    }

    const newConfig = {
      ...config,
      joins: [
        ...(config.joins || []),
        { type, table: String(fullTableName), leftColumn, rightColumn, alias }
      ]
    };
    return newConfig;
  }

  /**
   * Parses a table name to detect cross-database references
   * @param tableName - The table name to parse
   * @returns Object with parsing results
   */
  private parseTableName<TableName extends TableReference<Schema>>(
    tableName: TableName
  ): { isCrossDatabase: boolean; fullTableName: TableName } {
    const tableNameStr = String(tableName);

    // Check if table name contains a dot (database.table format)
    const parts = tableNameStr.split('.');

    if (parts.length === 2) {
      const [database, table] = parts;
      return {
        isCrossDatabase: true,
        fullTableName: `\`${database}\`.\`${table}\`` as TableName // Escape identifiers
      };
    }

    return {
      isCrossDatabase: false,
      fullTableName: tableName
    };
  }

  /**
   * Validates cross-database access
   * @param fullTableName - The fully qualified table name
   */
  private validateCrossDatabaseAccess<TableName extends TableReference<Schema>>(fullTableName: TableName): void {
    const fullTableNameStr = String(fullTableName);

    // Extract database name for validation
    const match = fullTableNameStr.match(/`([^`]+)`\.`([^`]+)`/);
    if (match) {
      const [, database] = match;

      // Add any cross-database specific validation here
      // For example, check if the database is in the allowed list
      const allowedCrossDatabases = ['information_schema', 'system'];

      if (!allowedCrossDatabases.includes(database)) {
        console.warn(`Warning: Joining with database '${database}' may require special permissions`);
      }
    }
  }
} 