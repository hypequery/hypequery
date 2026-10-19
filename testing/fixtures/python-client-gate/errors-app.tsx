import React, { useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient } from '@tanstack/react-query';
import { HypequeryProvider, createAnalyticsHooks, createHypequeryClient } from '@hypequery/react';
import { clientManifest, type ClientApi } from './client.generated.js';
const hooks = createAnalyticsHooks<ClientApi>();
type Scenario = 'refresh' | 'unauthorized' | 'forbidden' | 'validation' | 'stale' | 'rate' | 'server' | 'unavailable';
type Stats = { calls: number; refreshes: number };
function Result({ scenario, stats }: { scenario: Scenario; stats: Stats }) {
  const result = hooks.useDataset('orders', { dimensions: [], measures: ['revenue'], ...(scenario === 'validation' ? { limit: 0 } : {}) });
  return <section><p role="status">{result.isFetching ? 'Loading' : result.error ? 'Error' : result.data ? 'Ready' : 'Loading'}</p>
    <pre id="result">{JSON.stringify({ scenario, calls: stats.calls, refreshes: stats.refreshes, status: result.error?.status, body: result.error?.body, data: result.data?.data })}</pre>
  </section>;
}
function App() {
  const [session, setSession] = useState<{ scenario: Scenario; stats: Stats; client: ReturnType<typeof createHypequeryClient<ClientApi>>; queries: QueryClient }>();
  function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const validToken = String(values.get('token'));
    const scenario = String(values.get('scenario')) as Scenario;
    const stats = { calls: 0, refreshes: 0 };
    let token = scenario === 'refresh' || scenario === 'unauthorized' ? 'gate-expired-user' : scenario === 'forbidden' ? 'gate-denied-user' : validToken;
    const status = { rate: 429, server: 500, unavailable: 503 }[scenario as 'rate' | 'server' | 'unavailable'];
    const manifest = scenario === 'stale'
      ? Object.fromEntries(Object.entries(clientManifest).map(([name, entry]) => [name, { ...entry, schemaHash: '0'.repeat(64) }])) : clientManifest;
    session?.queries.clear();
    setSession({ scenario, stats, queries: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      client: createHypequeryClient<ClientApi>({ baseUrl: 'http://127.0.0.1:8000', manifest,
        ...(status ? { config: { 'dataset:orders': { path: `/v1/failure/${status}` } } } : {}),
        token: () => token,
        fetchFn: async (input, init) => { stats.calls++; return fetch(input, init); },
        onUnauthorized: async () => { stats.refreshes++; if (scenario === 'refresh') token = validToken; },
      }),
    });
    form.querySelector<HTMLInputElement>('input[name="token"]')!.value = '';
  }
  return <main><h1>HTTP failure qualification</h1><form onSubmit={run}>
    <label>User token <input name="token" type="password" required /></label>
    <label>Scenario <select name="scenario">{['refresh', 'unauthorized', 'forbidden', 'validation', 'stale', 'rate', 'server', 'unavailable'].map(value => <option key={value}>{value}</option>)}</select></label>
    <button>Run scenario</button></form>
    {session && <HypequeryProvider client={session.client} queryClient={session.queries}><Result scenario={session.scenario} stats={session.stats} /></HypequeryProvider>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
