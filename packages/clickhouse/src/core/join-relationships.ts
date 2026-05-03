import { JoinType } from '../types/index.js';
import { ColumnType } from '../types/schema.js';

type SchemaTableName<Schema> = Extract<keyof Schema, string>;

export interface JoinPath<
  Schema,
  From extends string = SchemaTableName<Schema>,
  To extends SchemaTableName<Schema> = SchemaTableName<Schema>
> {
  from: From;
  to: To;
  leftColumn: string;
  rightColumn: string;
  type?: JoinType;
  alias?: string;
}

type AppendJoinPathSource<
  Schema,
  AvailableSources extends string,
  Path extends JoinPath<Schema, string, SchemaTableName<Schema>>
> = AvailableSources | (Path['alias'] extends string ? Path['alias'] : Path['to']);

type ValidateJoinPathChainInternal<
  Schema,
  AvailableSources extends string,
  Paths extends readonly JoinPath<Schema, string, SchemaTableName<Schema>>[]
> = Paths extends readonly [
  infer First,
  ...infer Rest,
]
  ? First extends JoinPath<Schema, AvailableSources, SchemaTableName<Schema>>
    ? Rest extends readonly JoinPath<Schema, string, SchemaTableName<Schema>>[]
      ? readonly [
        First,
        ...ValidateJoinPathChainInternal<
          Schema,
          AppendJoinPathSource<Schema, AvailableSources, First>,
          Rest
        >,
      ]
      : readonly [First]
    : never
  : readonly [];

export type ValidJoinPathChain<
  Schema,
  AvailableSources extends string,
  Paths extends readonly [
    JoinPath<Schema, AvailableSources, SchemaTableName<Schema>>,
    ...JoinPath<Schema, string, SchemaTableName<Schema>>[],
  ],
> = ValidateJoinPathChainInternal<Schema, AvailableSources, Paths>;

export interface JoinPathOptions {
  type?: JoinType;
  alias?: string;
  context?: Record<string, any>;
}

export class JoinRelationships<Schema extends { [K in keyof Schema]: { [columnName: string]: ColumnType } }> {
  private paths = new Map<string, JoinPath<Schema, string> | JoinPath<Schema, string>[]>();

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
  defineChain<
    Paths extends readonly [
      JoinPath<Schema>,
      ...JoinPath<Schema, string>[],
    ],
  >(name: string, paths: Paths & ValidJoinPathChain<Schema, SchemaTableName<Schema>, Paths>): void {
    if (this.paths.has(name)) {
      throw new Error(`Join chain '${name}' is already defined`);
    }
    if ((paths as readonly JoinPath<Schema, string>[]).length === 0) {
      throw new Error('Join chain must contain at least one path');
    }
    this.paths.set(name, [...paths]);
  }

  /**
   * Get a join relationship by name
   */
  get(name: string): JoinPath<Schema, string> | JoinPath<Schema, string>[] | undefined {
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
