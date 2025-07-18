import { ColumnType, JoinType } from '../types';

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

export class JoinRelationships<Schema extends { [K in keyof Schema]: { [columnName: string]: ColumnType } }> {
  private paths = new Map<string, JoinPath<Schema> | JoinPath<Schema>[]>();

  /**
   * Define a single join relationship
   */
  define(name: string, path: JoinPath<Schema>): void {
    if (this.paths.has(name)) {
      throw new Error(`Join relationship '${name}' is already defined`);
    }
    this.paths.set(name, path);
  }

  /**
   * Define a chain of join relationships
   */
  defineChain(name: string, paths: JoinPath<Schema>[]): void {
    if (this.paths.has(name)) {
      throw new Error(`Join chain '${name}' is already defined`);
    }
    if (paths.length === 0) {
      throw new Error('Join chain must contain at least one path');
    }
    this.paths.set(name, paths);
  }

  /**
   * Get a join relationship by name
   */
  get(name: string): JoinPath<Schema> | JoinPath<Schema>[] | undefined {
    return this.paths.get(name);
  }

  /**
   * Check if a join relationship exists
   */
  has(name: string): boolean {
    return this.paths.has(name);
  }

  /**
   * Remove a join relationship
   */
  remove(name: string): boolean {
    return this.paths.delete(name);
  }

  /**
   * Clear all join relationships
   */
  clear(): void {
    this.paths.clear();
  }

  /**
   * Get all defined relationship names
   */
  getDefinedRelationships(): string[] {
    return Array.from(this.paths.keys());
  }
} 