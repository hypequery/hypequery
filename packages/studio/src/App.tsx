import { ConnectionStatus } from '@/components/ConnectionStatus';
import { Logo } from '@/components/Logo';
import { QueryHistory } from '@/components/QueryHistory';

function App() {
  return (
    <div className="h-screen overflow-hidden bg-background">
      <header className="flex h-16 items-center justify-between border-b border-border bg-card/80 px-4 backdrop-blur-md md:px-6">
        <div className="flex items-center gap-4">
          <Logo />
          <span className="border-l border-border pl-4 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Studio / Runs
          </span>
        </div>
        <ConnectionStatus />
      </header>
      <main className="h-[calc(100vh-64px)]">
        <QueryHistory className="h-full" />
      </main>
    </div>
  );
}

export default App;
