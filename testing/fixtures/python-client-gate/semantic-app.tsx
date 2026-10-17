import React, { useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient } from '@tanstack/react-query';
import { HypequeryProvider, createAnalyticsHooks, createHypequeryClient } from '@hypequery/react';
import { clientManifest, type ClientApi } from './client.generated.js';
const hooks = createAnalyticsHooks<ClientApi>();
function Results() {
  const related = hooks.useDataset('joinedOrders', {
    dimensions: ['country', 'profile.label'], measures: ['revenue', 'profile.total', 'profile.minimum'],
    orderBy: [{ field: 'country', direction: 'asc' }],
  });
  const having = hooks.useDataset('joinedOrders', {
    dimensions: ['country'], measures: ['revenue'], having: [{ measure: 'revenue', operator: 'gte', value: 20 }],
    orderBy: [{ field: 'country', direction: 'asc' }],
  });
  const time = hooks.useDataset('joinedOrders', {
    dimensions: [], measures: ['revenue'], by: 'day', timezone: 'America/Los_Angeles',
    orderBy: [{ field: 'period', direction: 'asc' }],
  });
  if (related.data?.data[0]) {
    const total: string | null = related.data.data[0]['profile.total'];
    const label: string | null = related.data.data[0]['profile.label'];
    void total; void label;
  }
  return <section><p role="status">{related.error || having.error || time.error ? 'Failed' : related.data && having.data && time.data ? 'Ready' : 'Loading'}</p>
    <h2>Related</h2><pre>{JSON.stringify(related.data?.data)}</pre>
    <h2>Having</h2><pre>{JSON.stringify(having.data?.data)}</pre>
    <h2>Timezone</h2><pre>{JSON.stringify(time.data?.data)}</pre>
  </section>;
}
function App() {
  const [session, setSession] = useState<{ client: ReturnType<typeof createHypequeryClient<ClientApi>>; queries: QueryClient }>();
  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const token = String(new FormData(form).get('token'));
    session?.queries.clear();
    setSession({ client: createHypequeryClient<ClientApi>({ baseUrl: 'http://127.0.0.1:8000', manifest: clientManifest, token }), queries: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });
    form.reset();
  }
  return <main><h1>Semantic qualification</h1><form onSubmit={connect}><label>User token <input name="token" type="password" required /></label><button>Connect as user</button></form>
    {session && <HypequeryProvider client={session.client} queryClient={session.queries}><Results /></HypequeryProvider>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
