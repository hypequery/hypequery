import { QueryBuilder } from '../query-builder';
import { ColumnType, PaginationOptions, PaginatedResult, PageInfo, TableColumn } from '../../types';

export class PaginationFeature<
  Schema extends { [tableName: string]: { [columnName: string]: ColumnType } },
  T,
  HasSelect extends boolean = false,
  Aggregations = {},
  OriginalT = T
> {
  constructor(private builder: QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT>) { }

  private encodeCursor(values: Record<string, any>): string {
    return Buffer.from(JSON.stringify(values)).toString('base64');
  }

  private decodeCursor(cursor: string): Record<string, any> {
    return JSON.parse(Buffer.from(cursor, 'base64').toString());
  }

  async paginate(options: PaginationOptions<T>): Promise<PaginatedResult<T>> {
    const config = this.builder.getConfig();
    const { pageSize, after, before, orderBy } = options;

    // Apply ordering
    if (orderBy) {
      orderBy.forEach(({ column, direction }) => {
        const typedColumn = column as unknown as keyof T | TableColumn<Schema>;
        this.builder.orderBy(typedColumn, direction);
      });
    }

    // Apply cursor conditions
    if (after || before) {
      const cursor = this.decodeCursor(after || before || '');
      const direction = after ? 'gt' : 'lt';

      Object.entries(cursor).forEach(([column, value]) => {
        const typedColumn = column as unknown as keyof OriginalT;
        this.builder.where(typedColumn, direction as any, value);
      });
    }

    // Get one extra record to determine if there's a next/previous page
    const limit = pageSize + 1;
    this.builder.limit(limit);

    // Execute query
    const results = await this.builder.execute();
    const hasMore = results.length > pageSize;

    // Only take pageSize records for the actual data
    const data = results.slice(0, pageSize);

    // Generate cursors
    const startCursor = data.length > 0 ? this.generateCursor(data[0], orderBy) : '';
    const endCursor = data.length > 0 ? this.generateCursor(data[data.length - 1], orderBy) : '';

    const pageInfo: PageInfo = {
      hasNextPage: hasMore,
      hasPreviousPage: !!after,
      startCursor,
      endCursor
    };

    return { data, pageInfo };
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