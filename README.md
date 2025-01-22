# HypeQuery: Real-time ClickHouse Query Engine

Strongly typed, real-time analytics SDK for ClickHouse. 

## Example Usage
```typescript
const queries = {
  hourlyEvents: defineQuery((db) => 
    db.table('events')
      .select('count() as total')
      .timeWindow('1 hour')
      .groupBy('minute')
  )
};

// React Hook
function Dashboard() {
  const { data } = useQuery(queries.hourlyEvents);
  return <Chart data={data} />;
}