import { initServe } from '../packages/serve/dist/index.js'

const { query, serve } = initServe({
  context: () => ({
    db: {
      revenue: (startDate: string, endDate: string) => ({
        total: 10000,
        startDate,
        endDate,
      }),
      expenses: () => ({ total: 5000 }),
    },
  }),
})

console.log('\n=== Object-style query + execute() ===')

const revenue = query({
  name: 'revenue',
  description: 'Monthly revenue calculation',
  query: async ({ input, ctx }) => {
    return ctx.db.revenue(input.startDate, input.endDate)
  },
})

const revenueResult = await revenue.execute({
  input: {
    startDate: '2024-01-01',
    endDate: '2024-01-31',
  },
})

console.log('Revenue result:', revenueResult)

console.log('\n=== Builder-style query still works ===')

const expenses = query
  .query(async ({ ctx }) => {
    return ctx.db.expenses()
  })

const api = serve({
  queries: { revenue, expenses },
})

console.log('Queries:', Object.keys(api.queries))
console.log('Execute revenue via serve:', await api.execute('revenue', {
  input: {
    startDate: '2024-01-01',
    endDate: '2024-01-31',
  },
}))
console.log('Execute expenses via serve:', await api.execute('expenses'))
