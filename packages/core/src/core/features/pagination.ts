import { QueryBuilder } from '../query-builder';
import { ColumnType, PaginationOptions, PaginatedResult, PageInfo, TableColumn } from '../../types';

export class PaginationFeature<
  Schema extends { [tableName: string]: { [columnName: string]: ColumnType } },
  T,
  HasSelect extends boolean = false,
  Aggregations = {},
  OriginalT = T
> {
  private static cursorStacks: Map<string, { stack: string[]; position: number }> = new Map();
  private stackKey: string;

  constructor(private builder: QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT>) {
    // Create a unique key for this pagination instance based on the table and sort
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

  async paginate(options: PaginationOptions<T>): Promise<PaginatedResult<T>> {
    const { pageSize, after, before, orderBy = [] } = options;
    const requestSize = pageSize + 1;

    // Update cursor stack
    if (after) {
      // Moving forward: add new cursor and update position
      if (this.currentPosition < this.cursorStack.length - 1) {
        // If we're not at the end, truncate the stack
        this.cursorStack = this.cursorStack.slice(0, this.currentPosition + 1);
      }
      this.cursorStack = [...this.cursorStack, after];
      this.currentPosition = this.cursorStack.length - 1;
    } else if (before) {
      // Moving backward: find the cursor in the stack
      const cursorIndex = this.cursorStack.indexOf(before);

      if (cursorIndex === -1) {
        // If cursor not found in stack, add it
        if (this.currentPosition === this.cursorStack.length - 1) {
          this.cursorStack = [...this.cursorStack, before];
        }
        // Move back one position
        this.currentPosition = Math.max(-1, this.currentPosition - 1);
      } else {
        // Move to the previous cursor position
        this.currentPosition = Math.max(-1, cursorIndex - 1);
      }
    } else {
      // Reset for first page only if we don't have a cursor
      if (!this.cursorStack.length) {
        this.cursorStack = [];
        this.currentPosition = -1;
      }
    }


    // Apply ordering first
    orderBy.forEach(({ column, direction }) => {
      this.builder.orderBy(column as any, direction);
    });

    // Handle cursor-based pagination
    const cursor = after || before;
    if (cursor && orderBy && orderBy.length > 0) {
      const [{ column, direction }] = orderBy;
      const columnName = String(column);
      const cursorValues = this.decodeCursor(cursor);
      const value = cursorValues[columnName];

      if (before) {
        // For backward pagination:
        // If sorting DESC, we want records > cursor
        // If sorting ASC, we want records < cursor
        const operator = direction === 'DESC' ? 'gt' : 'lt';
        this.builder.where(columnName as any, operator, value);
        // Reverse the order for backward pagination
        orderBy.forEach(({ column, direction }) => {
          const reversedDirection = direction === 'DESC' ? 'ASC' : 'DESC';
          this.builder.orderBy(column as any, reversedDirection);
        });
      } else {
        // For forward pagination:
        // If sorting DESC, we want records < cursor
        // If sorting ASC, we want records > cursor
        const operator = direction === 'DESC' ? 'lt' : 'gt';
        this.builder.where(columnName as any, operator, value);
      }
    }

    this.builder.limit(requestSize);

    // Execute query
    let results = await this.builder.execute();


    // For backward pagination, we need to reverse the results
    if (before) {
      results = results.reverse();
    }

    // Only take pageSize records for the actual data
    const data = results.slice(0, pageSize);

    // Generate cursors
    const startCursor = data.length > 0 ? this.generateCursor(data[0], orderBy) : '';
    const endCursor = data.length > 0 ? this.generateCursor(data[data.length - 1], orderBy) : '';

    // Determine if there are more pages
    const hasMore = results.length > pageSize;

    // For the first page
    if (!cursor) {
      return {
        data,
        pageInfo: {
          hasNextPage: hasMore,
          hasPreviousPage: data.length > 0 && this.currentPosition > 0, // Only true if we have data and previous cursors
          startCursor,
          endCursor,
          totalCount: 0,
          totalPages: 0,
          pageSize
        }
      };
    }

    // For pages accessed via 'before' cursor
    if (before) {
      return {
        data,
        pageInfo: {
          hasNextPage: true, // We can always go forward when we've gone back
          hasPreviousPage: data.length > 0 && (this.currentPosition >= 0 || hasMore), // Only true if we have data and history or more results
          startCursor,
          endCursor,
          totalCount: 0,
          totalPages: 0,
          pageSize
        }
      };
    }

    // For pages accessed via 'after' cursor
    return {
      data,
      pageInfo: {
        hasNextPage: hasMore,
        hasPreviousPage: data.length > 0, // Only true if we have data
        startCursor,
        endCursor,
        totalCount: 0,
        totalPages: 0,
        pageSize
      }
    };
  }

  private generateCursor(record: T, orderBy?: PaginationOptions<T>['orderBy']): string {
    const cursorData: Record<string, any> = {};

    if (orderBy) {
      orderBy.forEach(({ column }) => {
        const columnName = String(column);
        cursorData[columnName] = (record as Record<string, any>)[columnName];
      });
    } else {
      // Use primary key or first column as default
      const [firstColumn] = Object.keys(record as object);
      if (firstColumn) {
        cursorData[firstColumn] = (record as Record<string, any>)[firstColumn];
      }
    }

    return this.encodeCursor(cursorData);
  }

  async firstPage(pageSize: number): Promise<PaginatedResult<T>> {
    return this.paginate({ pageSize });
  }

  async *iteratePages(pageSize: number): AsyncGenerator<PaginatedResult<T>> {
    let currentCursor: string | undefined;

    while (true) {
      const result = await this.paginate({
        pageSize,
        after: currentCursor
      });

      yield result;

      if (!result.pageInfo.hasNextPage) {
        break;
      }

      currentCursor = result.pageInfo.endCursor;
    }
  }
}
