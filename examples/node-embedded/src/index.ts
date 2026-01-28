import { api } from './analytics/api.js';

async function run() {
  const now = new Date();
  const end = now.toISOString().split('T')[0];
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - 28);
  const start = startDate.toISOString().split('T')[0];

  const [revenue, passengers] = await Promise.all([
    api.run('weeklyRevenue', { input: { start, end } }),
    api.run('passengerStats'),
  ]);

  console.log('Weekly revenue (last 4 weeks):');
  console.table(revenue);
  console.log('\nPassenger stats:', passengers);
}

run().catch((error) => {
  console.error('Unable to run embedded analytics:', error);
  process.exit(1);
});
