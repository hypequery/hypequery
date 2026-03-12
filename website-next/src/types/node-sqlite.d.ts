declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }

  export class StatementSync {
    all<T = Record<string, unknown>>(...params: unknown[]): T[];
    get<T = Record<string, unknown>>(...params: unknown[]): T | undefined;
    run(...params: unknown[]): {
      changes: number;
      lastInsertRowid: number | bigint;
    };
  }
}
