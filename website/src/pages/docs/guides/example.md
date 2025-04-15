---
title: Example Guide
description: A guide in my new Starlight docs site.
order: 1
---

# Example Guide

This is an example guide that demonstrates how to use hypequery effectively.

## Basic Usage

Here's a simple example:

```typescript
import { createQueryBuilder } from '@hypequery/core';

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
