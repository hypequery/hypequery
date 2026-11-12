import { logger } from '@hypequery/clickhouse';
import { invoicePreview } from '../analytics/billing.js';
import { db } from '../analytics/client.js';

logger.configure({ level: 'warn' }); // keep the printout readable

/**
 * The billing job: the second consumer of the same definitions the API
 * serves. Runs in-process, one tenant at a time, for a closed period.
 *
 *   pnpm invoices -- 2026-09 170 153 146
 */
const [periodId = '2026-09', ...tenants] = process.argv.slice(2);
const tenantIds = tenants.length > 0 ? tenants : ['170', '153', '146'];

for (const tenantId of tenantIds) {
  const invoice = await invoicePreview(tenantId, periodId);
  console.log(`\ntenant ${tenantId} · ${invoice.plan} · ${invoice.period}`);
  for (const line of invoice.lines) {
    console.log(`  ${line.description.padEnd(46)} ${String(line.quantity).padStart(5)} x ${line.unitPrice.padStart(7)} = ${line.amount.padStart(9)}`);
  }
  console.log(`  ${'total'.padEnd(66)} ${invoice.total.padStart(9)} ${invoice.currency ?? ''}`);
}

await db.close();
