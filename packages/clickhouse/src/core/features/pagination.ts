import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import { PaginatedResult, PaginationOptions } from '../../types/index.js';

export class PaginationFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>
> {
  private static cursorStacks: Map<string, { stack: string[]; position: number }> = new Map();
  private stackKey: string;

  constructor(private builder: QueryBuilder<Schema, State>) {
    this.stackKey = builder.getTableName();
    if (!PaginationFeature.cursorStacks.has(this.stackKey)) {
      PaginationFeature.cursorStacks.set(this.stackKey, { stack: [], position: -1 });
    }
  }

  private get cursorStack(): string[] {
    return PaginationFeature.cursorStacks.get(this.stackKey)!.stack;
  }

  private set cursorStack(value: string[]) {
    const current = PaginationFeature.cursorStacks.get(this.stackKey)!;
    PaginationFeature.cursorStacks.set(this.stackKey, { ...current, stack: value });
  }

  private get currentPosition(): number {
    return PaginationFeature.cursorStacks.get(this.stackKey)!.position;
  }

  private set currentPosition(value: number) {
    const current = PaginationFeature.cursorStacks.get(this.stackKey)!;
    PaginationFeature.cursorStacks.set(this.stackKey, { ...current, position: value });
  }

  private encodeCursor(values: Record<string, any>): string {
    return Buffer.from(JSON.stringify(values)).toString('base64');
  }

  private decodeCursor(cursor: string): Record<string, any> {
    return JSON.parse(Buffer.from(cursor, 'base64').toString());
  }

  async paginate(options: PaginationOptions<State['output']>): Promise<PaginatedResult<State['output']>> {
    const { pageSize, after, before, orderBy = [] } = options;
    const requestSize = pageSize + 1;

    if (after) {
      if (this.currentPosition < this.cursorStack.length - 1) {
        this.cursorStack = this.cursorStack.slice(0, this.currentPosition + 1);
      }
      this.cursorStack = [...this.cursorStack, after];
      this.currentPosition = this.cursorStack.length - 1;
    } else if (before) {
      const cursorIndex = this.cursorStack.indexOf(before);

      if (cursorIndex === -1) {
        if (this.currentPosition === this.cursorStack.length - 1) {
          this.cursorStack = [...this.cursorStack, before];
        }
        this.currentPosition = Math.max(-1, this.currentPosition - 1);
      } else {
        this.currentPosition = Math.max(-1, cursorIndex - 1);
      }
    } else {
      if (!this.cursorStack.length) {
        this.cursorStack = [];
        this.currentPosition = -1;
      }
    }

    orderBy.forEach(({ column, direction }) => {
      this.builder.orderBy(column as any, direction);
    });

    const cursor = after || before;
    if (cursor && orderBy && orderBy.length > 0) {
      const [{ column, direction }] = orderBy;
      const columnName = String(column);
      const cursorValues = this.decodeCursor(cursor);
      const value = cursorValues[columnName];

      if (before) {
        const operator = direction === 'DESC' ? 'gt' : 'lt';
        this.builder.where(columnName as any, operator, value);
        orderBy.forEach(({ column, direction }) => {
          const reversedDirection = direction === 'DESC' ? 'ASC' : 'DESC';
          this.builder.orderBy(column as any, reversedDirection);
        });
      } else {
        const operator = direction === 'DESC' ? 'lt' : 'gt';
        this.builder.where(columnName as any, operator, value);
      }
    }

    this.builder.limit(requestSize);

    // Pagination mutates builder state per page; bypass caching until pagination-specific caching is designed.
    let results = await this.builder.execute({ cache: { mode: 'no-store' } });

    if (before) {
      results = results.reverse();
    }

    const data = results.slice(0, pageSize);

    const startCursor = data.length > 0 ? this.generateCursor(data[0], orderBy) : '';
    const endCursor = data.length > 0 ? this.generateCursor(data[data.length - 1], orderBy) : '';

    const hasMore = results.length > pageSize;

    if (!cursor) {
      return {
        data,
        pageInfo: {
          hasNextPage: hasMore,
          hasPreviousPage: data.length > 0 && this.currentPosition > 0,
          startCursor,
          endCursor,
          totalCount: 0,
          totalPages: 0,
          pageSize
        }
      };
    }

    if (before) {
      return {
        data,
        pageInfo: {
          hasNextPage: true,
          hasPreviousPage: data.length > 0 && (this.currentPosition >= 0 || hasMore),
          startCursor,
          endCursor,
          totalCount: 0,
          totalPages: 0,
          pageSize
        }
      };
    }

    return {
      data,
      pageInfo: {
        hasNextPage: hasMore,
        hasPreviousPage: data.length > 0,
        startCursor,
        endCursor,
        totalCount: 0,
        totalPages: 0,
        pageSize
      }
    };
  }

  private generateCursor(record: State['output'], orderBy?: PaginationOptions<State['output']>['orderBy']): string {
    const cursorData: Record<string, any> = {};

    if (orderBy) {
      orderBy.forEach(({ column }) => {
        const columnName = String(column);
        cursorData[columnName] = (record as Record<string, any>)[columnName];
      });
    } else {
      const [firstColumn] = Object.keys(record as object);
      if (firstColumn) {
        cursorData[firstColumn] = (record as Record<string, any>)[firstColumn];
      }
    }

    return this.encodeCursor(cursorData);
  }

  async firstPage(pageSize: number): Promise<PaginatedResult<State['output']>> {
    return this.paginate({ pageSize });
  }

  iteratePages(pageSize: number): AsyncGenerator<PaginatedResult<State['output']>> {
    return this.paginationGenerator(pageSize);
  }

  private async *paginationGenerator(pageSize: number): AsyncGenerator<PaginatedResult<State['output']>> {
    let cursor: string | undefined;

    while (true) {
      const result = await this.paginate({ pageSize, after: cursor });
      yield result;

      if (!result.pageInfo.hasNextPage) break;
      cursor = result.pageInfo.endCursor;
    }
  }
}
