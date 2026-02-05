import { JoinType } from '../types/index.js';
import { ColumnType } from '../types/schema.js';
export interface JoinPath<Schema> {
    from: keyof Schema;
    to: keyof Schema;
    leftColumn: string;
    rightColumn: string;
    type?: JoinType;
    alias?: string;
}
export interface JoinPathOptions {
    type?: JoinType;
    alias?: string;
    context?: Record<string, any>;
}
export declare class JoinRelationships<Schema extends {
    [K in keyof Schema]: {
        [columnName: string]: ColumnType;
    };
}> {
    private paths;
    /**
     * Define a single join relationship
     */
    define(name: string, path: JoinPath<Schema>): void;
    /**
     * Define a chain of join relationships
     */
    defineChain(name: string, paths: JoinPath<Schema>[]): void;
    /**
     * Get a join relationship by name
     */
    get(name: string): JoinPath<Schema> | JoinPath<Schema>[] | undefined;
    /**
     * Check if a join relationship exists
     */
    has(name: string): boolean;
    /**
     * Remove a join relationship
     */
    remove(name: string): boolean;
    /**
     * Clear all join relationships
     */
    clear(): void;
    /**
     * Get all defined relationship names
     */
    getDefinedRelationships(): string[];
}
//# sourceMappingURL=join-relationships.d.ts.map