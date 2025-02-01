import { useEffect, useState } from 'react';
import { createQueryBuilder, } from '@hypequery/core';
import { IntrospectedSchema } from './generated/generated-schema';
import './styles.css';

const db = createQueryBuilder<IntrospectedSchema>({
  host: import.meta.env.VITE_CLICKHOUSE_HOST,
  username: import.meta.env.VITE_CLICKHOUSE_USER,
  password: import.meta.env.VITE_CLICKHOUSE_PASSWORD,
  database: import.meta.env.VITE_CLICKHOUSE_DATABASE,
});

type DBType = typeof db;



function App() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {

        const results = await db
          .table('uk_price_paid')
          .select(['uk_price_paid.county', 'uk_price_paid.county', 'price', 'postcode1', 'type'])
          .innerJoin(
            'property_details',
            'type',
            'property_details.type'
          )
          .count('price')
          .orderBy('total_price', 'DESC')
          .limit(100)
          .execute();

        console.log({ results });


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