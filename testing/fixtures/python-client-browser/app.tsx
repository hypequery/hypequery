import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient } from '@tanstack/react-query';
import { HypequeryProvider, createAnalyticsHooks, createHypequeryClient } from '@hypequery/react';
import { clientManifest, type ClientApi } from './client.generated.js';

const hooks = createAnalyticsHooks<ClientApi>();
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Results() {
  const query = hooks.useDataset('orders', { dimensions: ['country'], measures: ['revenue'], orderBy: [{ field: 'country', direction: 'asc' }] });
  const metric = hooks.useMetric('sales', {});
  const pages = hooks.useInfiniteDataset('orders', { dimensions: ['country'], measures: ['revenue'], orderBy: [{ field: 'country', direction: 'asc' }], limit: 1 });
  const error = query.error ?? metric.error ?? pages.error;
  return <>
    <p role="status">{error ? `HTTP ${error.status}` : query.data && metric.data && pages.data ? 'Ready' : 'Loading'}</p>
    <h2>Dataset</h2><pre id="dataset">{JSON.stringify(query.data?.data)}</pre>
    <h2>Metric</h2><pre id="metric">{JSON.stringify(metric.data?.data)}</pre>
    <h2>Pages</h2><pre id="pages">{JSON.stringify(pages.data?.pages.map(page => page.data))}</pre>
    <button disabled={!pages.hasNextPage || pages.isFetchingNextPage} onClick={() => pages.fetchNextPage()}>Load next page</button>
  </>;
}

function App() {
  const [user, setUser] = useState<'a' | 'b'>('a');
  const [stale, setStale] = useState(false);
  const client = useMemo(() => createHypequeryClient<ClientApi>({
    baseUrl: 'http://127.0.0.1:8790',
    manifest: stale ? Object.fromEntries(Object.entries(clientManifest).map(([name, entry]) => [name, { ...entry, schemaHash: '0'.repeat(64) }])) : clientManifest,
    token: `browser-${user}`,
    // Scope includes deployment/schema/principal. Tokens are public fixture credentials only.
    cacheKey: `fixture:${user}:${stale}`,
  }), [user, stale]);
  return <main><h1>Python client browser qualification</h1>
    <p>Principal {user.toUpperCase()} · {stale ? 'stale schema' : 'current schema'}</p>
    <button onClick={() => setUser(user === 'a' ? 'b' : 'a')}>Switch principal</button>
    <button onClick={() => setStale(!stale)}>Toggle stale schema</button>
    <HypequeryProvider client={client} queryClient={queryClient}><Results /></HypequeryProvider>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
