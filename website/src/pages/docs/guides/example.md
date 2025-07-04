---
title: "Example Guide"
description: "Learn how to use hypequery with a practical example"
order: 1
---

# Example Guide

This guide shows you how to use hypequery to build type-safe ClickHouse queries.

## Basic Usage

Here's a simple example:

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';

const db = createQueryBuilder({
  host: 'your-clickhouse-host',
  database: 'your-database'
});

const results = await db
  .table('users')
  .select(['id', 'name'])
  .where('active', 'eq', true)
  .execute();
```

## Next Steps

- Check out the [Query Building](/docs/guides/query-building) guide
- Learn about [Join Relationships](/docs/guides/joins)
- Master [Advanced Filtering](/docs/guides/filtering)

## Further reading

- Read [about how-to guides](https://diataxis.fr/how-to-guides/) in the Diátaxis framework
