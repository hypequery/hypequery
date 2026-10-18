import React, { useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient } from '@tanstack/react-query';
import { HypequeryProvider, createAnalyticsHooks, createHypequeryClient } from '@hypequery/react';
import { clientContractHash, clientManifest, type ClientApi } from './client.generated.js';

const hooks = createAnalyticsHooks<ClientApi>();
function Results() {
  const dataset = hooks.useDataset('orders', { dimensions: ['country'], measures: ['revenue'] });
  const metric = hooks.useMetric('sales', {});
  const pages = hooks.useInfiniteDataset('orders', {
    dimensions: ['country'], measures: ['revenue'],
    orderBy: [{ field: 'country', direction: 'asc' }], limit: 1,
  });
  const metricPages = hooks.useInfiniteMetric('sales', {
    dimensions: ['country'], orderBy: [{ field: 'country', direction: 'asc' }], limit: 1,
  });
  const error = dataset.error ?? metric.error ?? pages.error ?? metricPages.error;
  return <section>
    <p role="status">{error ? `HTTP ${error.status}: ${error.message}` : dataset.data && metric.data && pages.data && metricPages.data ? 'Ready' : 'Loading'}</p>
    <h2>Revenue by country</h2><pre>{JSON.stringify(dataset.data?.data, null, 2)}</pre>
    <h2>Sales metric</h2><pre>{JSON.stringify(metric.data?.data, null, 2)}</pre>
    <h2>Dataset pages</h2><pre>{JSON.stringify(pages.data?.pages.map(page => page.data), null, 2)}</pre>
    <button disabled={!pages.hasNextPage || pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>Next dataset page</button>
    <h2>Metric pages</h2><pre>{JSON.stringify(metricPages.data?.pages.map(page => page.data), null, 2)}</pre>
    <button disabled={!metricPages.hasNextPage || metricPages.isFetchingNextPage} onClick={() => void metricPages.fetchNextPage()}>Next metric page</button>
  </section>;
}
function App() {
  const [session, setSession] = useState<{
    client: ReturnType<typeof createHypequeryClient<ClientApi>>;
    queries: QueryClient;
  }>();
  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const token = String(new FormData(form).get('token') ?? '').trim();
    if (!token) return;
    // A new client and QueryClient isolate each login. Never share a cache by token alone.
    session?.queries.clear();
    setSession({
      client: createHypequeryClient<ClientApi>({
        baseUrl: 'http://127.0.0.1:8000', manifest: clientManifest, token,
        cacheKey: `tutorial:${clientContractHash}:${crypto.randomUUID()}`,
      }),
      queries: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    });
    form.reset();
  }
  return <main><h1>Python datasets dashboard</h1>
    <p>Enter one tutorial user's token. The browser never receives a database credential.</p>
    <form onSubmit={connect}>
      <label>User token <input name="token" type="password" required autoComplete="off" /></label>
      <button>Connect as user</button>
    </form>
    {session && <HypequeryProvider client={session.client} queryClient={session.queries}><Results /></HypequeryProvider>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
