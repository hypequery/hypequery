import {
  toStartOfMinute,
  toStartOfHour,
  toStartOfDay,
  toStartOfWeek,
  toStartOfMonth,
  toStartOfQuarter,
  toStartOfYear,
} from '../../index.js';
import {
  createDatasetClient,
  dataset,
  dimension,
  eq,
  measure,
} from '../../datasets.js';

describe('Public exports', () => {
  it('exports built-in ClickHouse start-of interval helpers from the package entrypoint', () => {
    expect(toStartOfMinute('created_at').toSql()).toBe('toStartOfMinute(created_at)');
    expect(toStartOfHour('created_at').toSql()).toBe('toStartOfHour(created_at)');
    expect(toStartOfDay('created_at').toSql()).toBe('toStartOfDay(created_at)');
    expect(toStartOfWeek('created_at').toSql()).toBe('toStartOfWeek(created_at, 1)');
    expect(toStartOfMonth('created_at').toSql()).toBe('toStartOfMonth(created_at)');
    expect(toStartOfQuarter('created_at').toSql()).toBe('toStartOfQuarter(created_at)');
    expect(toStartOfYear('created_at').toSql()).toBe('toStartOfYear(created_at)');
  });

  it('exports a datasets client from the datasets subpath', () => {
    const client = createDatasetClient({
      adapter: {
        name: 'test',
        query: async () => [],
      },
    });

    expect(typeof client.execute).toBe('function');
    expect(typeof client.toSQL).toBe('function');
  });

  it('renders semantic dataset plans through the ClickHouse datasets backend', async () => {
    const queries: string[] = [];
    const client = createDatasetClient({
      adapter: {
        name: 'test',
        query: async (sql) => {
          queries.push(sql);
          return [{ country: 'US', revenue: 100 }];
        },
      },
    });
    const Orders = dataset('orders', {
      source: 'orders',
      dimensions: {
        country: dimension.string(),
        status: dimension.string(),
      },
      measures: {
        revenue: measure.sum('amount'),
        completedRevenue: measure.sum('amount', {
          filters: [eq('status', 'completed')],
        }),
      },
    });

    const result = await client.execute(Orders, {
      dimensions: ['country'],
      measures: ['revenue'],
    });

    expect(result.data).toEqual([{ country: 'US', revenue: 100 }]);
    expect(queries[0]).toContain('SELECT country, SUM(amount) AS revenue FROM orders');
    expect(queries[0]).toContain('GROUP BY country');

    await client.execute(Orders, {
      dimensions: ['country'],
      measures: ['completedRevenue'],
    });

    expect(queries[1]).toContain("SUM(if((status = 'completed'), amount, 0)) AS completedRevenue");
  });
});
