import { useEffect, useState } from 'react';
import { createQueryBuilder, CrossFilter } from '@hypequery/core';
import { IntrospectedSchema } from './generated/generated-schema';
import './styles.css';

const db = createQueryBuilder<IntrospectedSchema>({
  host: import.meta.env.VITE_CLICKHOUSE_HOST,
  username: import.meta.env.VITE_CLICKHOUSE_USER,
  password: import.meta.env.VITE_CLICKHOUSE_PASSWORD,
  database: import.meta.env.VITE_CLICKHOUSE_DATABASE,
});

// Create a type for filters using the keys from the "uk_price_paid" table
// You could also derive individual column names if needed.
type UkPricePaidFilters = {
  // For example, filter by type (e.g. 'Sale' or 'Purchase')
  type?: string;
  // Multi-select filter: filtering using town values from the schema.
  towns?: string[];
  // Date range filters using the "date" column.
  startDate?: string;
  endDate?: string;
};

/**
 * Creates a CrossFilter instance based on dynamic filter values.
 * This centralizes filter logic using types from your schema.
 */
function createUKPricePaidCrossFilter(filters: UkPricePaidFilters): CrossFilter {
  const crossFilter = new CrossFilter();

  if (filters.type) {
    crossFilter.add({
      column: 'type',
      operator: 'eq',
      value: filters.type,
    });
  }

  // Applying a multi-select filter using the "in" operator.
  if (filters.towns && filters.towns.length > 0) {
    crossFilter.add({
      column: 'town',
      operator: 'in',
      value: filters.towns,
    });
  }

  if (filters.startDate && filters.endDate) {
    crossFilter.add({
      column: 'date',
      operator: 'between',
      value: [filters.startDate, filters.endDate],
    });
  }

  return crossFilter;
}



function App() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pricePaidFilters: UkPricePaidFilters = {
    type: 'detached',
    towns: ['London', 'Manchester'],
    //  startDate: '2022-01-01',
    //  endDate: '2022-12-31',
  };


  const crossFilter = createUKPricePaidCrossFilter(pricePaidFilters);

  useEffect(() => {
    const fetchData = async () => {
      try {
        //TODO:
        // 1. Write tests for date functions
        // 2. check the 
        // const results = await db
        //   .table('uk_price_paid')
        //   .select(['uk_price_paid.county', 'uk_price_paid.county', 'postcode1', 'type', 'price'])
        //   .where('price', 'gt', 1000000)
        //   .orWhere('price', 'lt', 1000000)
        //   .toSQL()
        //  .execute();

        console.log({ crossFilter });

        const qb = await db.table('uk_price_paid')
          .select(['date', 'price', 'town'])
          .sum('price', 'total_price')
          .where('price', 'in', ['200'])

        const results = await qb.execute();
        console.log({ results })

      } catch (err) {
        console.error('Error fetching data:', err);
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div className="App">
      <h1>UK Price Paid Data</h1>
      <div className="data-preview">
        <h2>Recent Properties Over £1M</h2>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Price</th>
              <th>Property Type</th>
              <th>Town/City</th>
              <th>Postcode</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record, i) => (
              <tr key={i}>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default App; 