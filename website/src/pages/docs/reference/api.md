---
layout: ../../../layouts/DocsLayout.astro
title: API Reference
description: Complete API reference for HypeQuery
---

# API Reference

This page provides a complete reference for all HypeQuery classes and methods.

## QueryBuilder

The main class for building queries.

### Methods

#### table(name: string)
Specifies the table to query.

```typescript
db.table('users')
```

#### select(columns: string[])
Specifies which columns to select.

```typescript
db.table('users').select(['id', 'name', 'email'])
```

## CrossFilter

Class for building complex filters.

### Methods

#### add(filter: FilterCondition)
Adds a single filter condition.

```typescript
filter.add({
  column: 'status',
  operator: 'eq',
  value: 'active'
})
``` 