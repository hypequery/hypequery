import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { eventually } from './utils/eventually.mjs';

const output = process.env.HYPEQUERY_GATE_OUTPUT;
assert(output);
const browser = await chromium.launch({ ...(process.env.HYPEQUERY_GATE_BROWSER_EXECUTABLE ? { executablePath: process.env.HYPEQUERY_GATE_BROWSER_EXECUTABLE } : {}) });
const context = await browser.newContext();
const page = await context.newPage();
const pageErrors = [];
const cases = [];
let responses = [];
page.on('pageerror', () => pageErrors.push('pageerror'));
page.on('response', response => {
  const request = response.request();
  if (request.method() !== 'POST' || !request.url().startsWith('http://127.0.0.1:8000/')) return;
  responses.push(response.allHeaders().then(headers => ({ status: response.status(), headers, pinned: /^[a-f0-9]{64}$/.test(request.headers()['x-hypequery-client-schema'] ?? '') })));
});
try {
  await page.goto('http://127.0.0.1:5173/errors.html');
  for (const [scenario, statuses, type] of [
    ['refresh', [401, 200]], ['unauthorized', [401, 401], 'UNAUTHORIZED'],
    ['forbidden', [403], 'FORBIDDEN'], ['validation', [400], 'VALIDATION_ERROR'],
    ['stale', [409], 'VALIDATION_ERROR'], ['rate', [429], 'RATE_LIMITED'],
    ['server', [500], 'INTERNAL_SERVER_ERROR'], ['unavailable', [503], 'SERVICE_UNAVAILABLE'],
  ]) {
    responses = [];
    await page.getByLabel('User token').fill(process.env.HYPEQUERY_TENANT_A_TOKEN);
    await page.getByLabel('Scenario').selectOption(scenario);
    await page.getByRole('button', { name: 'Run scenario' }).click();
    await eventually(async () => {
      const value = JSON.parse(await page.locator('#result').textContent());
      return value.scenario === scenario && await page.getByRole('status').textContent() === (type ? 'Error' : 'Ready');
    }, `HTTP scenario did not terminate: ${scenario}`);
    const result = JSON.parse(await page.locator('#result').textContent());
    assert.equal(result.calls, statuses.length, `${scenario}: unexpected retry`);
    assert.equal(result.refreshes, scenario === 'refresh' || scenario === 'unauthorized' ? 1 : 0);
    const observed = await Promise.all(responses);
    assert.deepEqual(observed.map(item => item.status), statuses);
    for (const response of observed) {
      assert(response.pinned);
      assert.equal(response.headers['access-control-allow-origin'], 'http://127.0.0.1:5173');
      if (response.status >= 400) {
        assert.equal(response.headers['cache-control'], 'no-store');
        assert(response.headers['x-request-id']);
      }
    }
    if (type) {
      assert.equal(result.status, statuses.at(-1));
      assert.equal(result.body.error.type, type);
      assert(!JSON.stringify(result.body).includes('GATE_PRIVATE_DRIVER_TEXT'));
    } else assert.match(result.data[0].revenue, /^60(?:\.0+)?$/);
    if (scenario === 'stale') assert.equal(result.body.error.details.code, 'CLIENT_SCHEMA_CHANGED');
    if (scenario === 'rate') assert.equal(observed[0].headers['retry-after'], '1');
    cases.push({ scenario, statuses, refreshes: result.refreshes, pinned: true, cors: true });
  }
  assert.deepEqual(pageErrors, []);
  await page.screenshot({ path: `${output}/errors-browser.png`, fullPage: true });
  await writeFile(`${output}/errors-browser.json`, JSON.stringify({ passed: true, cases, pageErrors }, null, 2));
  console.log('Real browser HTTP errors passed: successful refresh, bounded persistent 401, no refresh/retry for 400/403/409/429/500/503, canonical safe errors and CORS.');
} catch (error) {
  await page.screenshot({ path: `${output}/errors-browser-failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
}
