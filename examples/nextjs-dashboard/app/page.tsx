import { Dashboard } from '@/components/dashboard';

export default function Page() {
  return (
    <main className="page">
      <header className="page-header">
        <h1>Product analytics</h1>
        <p className="muted">
          One <code>dataset</code> on the server, one <code>useDataset</code> hook per panel. Click a bar to
          cross-filter every other panel; click it again to clear.
        </p>
      </header>
      <Dashboard />
    </main>
  );
}
