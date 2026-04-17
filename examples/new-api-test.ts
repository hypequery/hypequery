import { query, serve, initServe } from '@hypequery/serve'
import { z } from 'zod'

// Simulated database context
interface Context {
  db: {
    table: (name: string) => any
  }
}

// Example 1: New API - query() + serve()
console.log('\n=== Example 1: New API ===')

const revenue = query({
  name: 'revenue',
  description: 'Monthly revenue calculation',
  input: z.object({
    startDate: z.string(),
    endDate: z.string()
  }),
  query: async ({ input, ctx }: { input: any; ctx: Context }) => {
    console.log('Running revenue query with input:', input)
    return {
      total: 10000,
      startDate: input.startDate,
      endDate: input.endDate
    }
  }
})

const api1 = serve({
  revenue,
  context: () => ({
    db: {
      table: (name: string) => {
        console.log('Accessing table:', name)
        return {}
      }
    }
  })
})

console.log('API 1 created successfully')
console.log('Queries:', Object.keys(api1.queries))

// Example 2: New API with queries wrapper
console.log('\n=== Example 2: New API with queries wrapper ===')

const expenses = query({
  name: 'expenses',
  query: async ({ ctx }: { ctx: Context }) => {
    console.log('Running expenses query')
    return { total: 5000 }
  }
})

const api2 = serve({
  queries: { expenses },
  context: () => ({
    db: {
      table: (name: string) => ({})
    }
  })
})

console.log('API 2 created successfully')
console.log('Queries:', Object.keys(api2.queries))

// Example 3: Old API still works
console.log('\n=== Example 3: Old API (backward compatibility) ===')

const { define, query: queryBuilder } = initServe({
  context: () => ({
    db: {
      table: (name: string) => ({})
    }
  })
})

const api3 = define({
  queries: {
    users: queryBuilder
      .input(z.object({ limit: z.number() }))
      .query(async ({ input }) => {
        console.log('Running users query with limit:', input.limit)
        return { users: [], count: 0 }
      })
  }
})

console.log('API 3 created successfully (old API)')
console.log('Queries:', Object.keys(api3.queries))

// Example 4: Mixing both approaches
console.log('\n=== Example 4: Mixing new and old APIs ===')

const newQuery = query({
  name: 'newQuery',
  query: async () => ({ result: 'new' })
})

const { define: defineOld } = initServe({
  context: () => ({ db: { table: () => ({}) } })
})

const oldQuery = queryBuilder.query(async () => ({ result: 'old' }))

const api4 = serve({
  queries: {
    newQuery,
    oldQuery
  },
  context: () => ({ db: { table: () => ({}) } })
})

console.log('API 4 created successfully (mixed)')
console.log('Queries:', Object.keys(api4.queries))

// Example 5: Local execution
console.log('\n=== Example 5: Local execution ===')

const localQuery = query({
  name: 'local',
  query: async ({ input, ctx }: { input: any; ctx: Context }) => {
    return { message: 'Executed locally', input }
  }
})

const result = await localQuery.run({
  input: { test: 'data' },
  ctx: { db: { table: () => ({}) } }
})

console.log('Local execution result:', result)

console.log('\n=== All examples completed successfully! ===')
