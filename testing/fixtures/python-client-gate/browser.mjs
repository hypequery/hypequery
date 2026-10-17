import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { semanticRows } from './utils/semantic-rows.mjs';
import { eventually } from './utils/eventually.mjs';

// Seeded revenue per country for each tenant (examples/client_dashboard/seed.sql).
const TENANT_A = [['US', 10], ['DE', 20], [null, 30]];
const TENANT_B = [['CA', 100], ['UK', 900]];
/** Compare rows to seeded amounts; decimal strings may differ in trailing zeroes. */
function assertRevenue(rows, expected) {
  for (const row of rows) assert.equal(typeof (row.revenue ?? row.sales), 'string');
  const actual = rows.map(row => [row.country, Number(row.revenue ?? row.sales)]);
  const order = pairs => [...pairs].sort(([a], [b]) => String(a).localeCompare(String(b)));
  assert.deepEqual(order(actual), order(expected));
}

class Journey {
  constructor(page) { this.page = page; }
  async result(title) {
    return JSON.parse(await this.page.getByRole('heading', { name: title, exact: true }).locator('xpath=following-sibling::pre[1]').textContent());
  }
  async login(token, expected, revenue) {
    await this.page.getByRole('textbox', { name: 'User token' }).fill(token);
    await this.page.getByRole('button', { name: 'Connect as user' }).click();
    await eventually(async () => await this.page.getByRole('status').textContent() === 'Ready' && expected.test((await this.result('Sales metric'))[0].sales), 'Concurrent hooks did not become ready');
    assert.match((await this.result('Sales metric'))[0].sales, expected);
    const matches = async () => { try { assertRevenue(await this.result('Revenue by country'), revenue); return true; } catch { return false; } };
    await eventually(matches, 'Revenue by country did not match the tenant seed');
    assert.equal((await this.result('Dataset pages')).length, 1);
    assert.equal((await this.result('Metric pages')).length, 1);
  }
  async pages(count, revenue) {
    for (let index = 1; index < count; index++) {
      await this.page.getByRole('button', { name: 'Next dataset page' }).click();
      await this.page.getByRole('button', { name: 'Next metric page' }).click();
      await eventually(async () => (await this.result('Dataset pages')).length === index + 1 && (await this.result('Metric pages')).length === index + 1, 'Pagination did not advance');
    }
    assert(await this.page.getByRole('button', { name: 'Next dataset page' }).isDisabled());
    assert(await this.page.getByRole('button', { name: 'Next metric page' }).isDisabled());
    for (const title of ['Dataset pages', 'Metric pages']) {
      assertRevenue((await this.result(title)).flat(), revenue);
    }
  }
}
const output = process.env.HYPEQUERY_GATE_OUTPUT;
assert(output);
const browser = await chromium.launch({ ...(process.env.HYPEQUERY_GATE_BROWSER_EXECUTABLE ? { executablePath: process.env.HYPEQUERY_GATE_BROWSER_EXECUTABLE } : {}) });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
let posts = 0;
let pinned = 0;
let metadata = 0;
page.on('pageerror', () => errors.push('pageerror'));
page.on('console', message => { if (message.type() === 'error') errors.push('console error'); });
page.on('request', request => {
  if (request.method() === 'POST' && request.url().startsWith('http://127.0.0.1:8000/')) {
    posts++;
    const headers = request.headers();
    if (/^[a-f0-9]{64}$/.test(headers['x-hypequery-client-schema'] ?? '')) pinned++;
    if (headers['x-include-meta'] === 'true') metadata++;
  }
});
try {
  await page.goto('http://127.0.0.1:5173');
  const journey = new Journey(page);
  await journey.login(process.env.HYPEQUERY_TENANT_A_TOKEN, /^60(?:\.0+)?$/, TENANT_A);
  await journey.pages(3, TENANT_A);
  await journey.login(process.env.HYPEQUERY_TENANT_B_TOKEN, /^1000(?:\.0+)?$/, TENANT_B);
  await journey.pages(2, TENANT_B);
  await journey.login(process.env.HYPEQUERY_TENANT_A_TOKEN, /^60(?:\.0+)?$/, TENANT_A);
  await page.goto('http://127.0.0.1:5173/semantic.html');
  const oracle = JSON.parse(await readFile(`${output}/semantic-oracle.json`, 'utf8'));
  for (const [tenant, token] of [['a', process.env.HYPEQUERY_TENANT_A_TOKEN], ['b', process.env.HYPEQUERY_TENANT_B_TOKEN]]) {
    await page.getByRole('textbox', { name: 'User token' }).fill(token);
    await page.getByRole('button', { name: 'Connect as user' }).click();
    await eventually(async () => await page.getByRole('status').textContent() === 'Ready' && JSON.stringify(semanticRows(await journey.result('Related'))) === JSON.stringify(semanticRows(oracle[tenant].related)), 'Semantic hooks did not match independent SQL');
    for (const [title, name] of [['Related', 'related'], ['Having', 'having'], ['Timezone', 'time']]) assert.deepEqual(semanticRows(await journey.result(title)), semanticRows(oracle[tenant][name]));
  }
  assert(posts >= 18 && pinned === posts && metadata > 0);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${output}/browser.png`, fullPage: true });
  await writeFile(`${output}/browser.json`, JSON.stringify({ passed: true, browser: browser.version(), posts, pinned, metadata, principalSwitch: true, paginationTermination: true, relatedHavingTimezone: true, errors }, null, 2));
  console.log('Browser → installed Python → ClickHouse passed: four concurrent hooks, nulls/decimal strings, both paginations, A/B/A isolation and schema pins.');
} catch (error) {
  await page.screenshot({ path: `${output}/browser-failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/browser.json`, JSON.stringify({ passed: false, errors, posts, pinned, metadata }, null, 2));
  throw error;
} finally {
  await context.close();
  await browser.close();
}
