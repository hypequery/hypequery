import { api } from './analytics/api.js';

async function run() {
  const now = new Date();
  const end = now.toISOString().split('T')[0];
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - 28);
  const start = startDate.toISOString().split('T')[0];
  const demoDictionary = process.env.CLICKHOUSE_DEMO_DICTIONARY;

  const [revenue, passengers] = await Promise.all([
    api.run('weeklyRevenue', { input: { start, end } }),
    api.run('passengerStats'),
  ]);

  console.log('Weekly revenue (last 4 weeks):');
  console.table(revenue);
  console.log('\nPassenger stats:', passengers);

  if (demoDictionary) {
    const passengerLabels = await api.run('passengerLabels', {
      input: { limit: 10, dictionary: demoDictionary },
    });

    console.log(`\nPassenger labels from dictionary "${demoDictionary}":`);
    console.table(passengerLabels);
  } else {
    console.log(
      '\nSkipping passengerLabels dictGet demo. Set CLICKHOUSE_DEMO_DICTIONARY to run it.'
    );
  }
}

run().catch((error) => {
  console.error('Unable to run embedded analytics:', error);
  process.exit(1);
});
