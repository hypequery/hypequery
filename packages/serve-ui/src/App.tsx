import { ConnectionStatus } from '@/components/ConnectionStatus';
import { Logo } from '@/components/Logo';
import { QueryHistory } from '@/components/QueryHistory';

function App() {
  return (
    <div className="h-screen overflow-hidden bg-background">
      <header className="flex h-14 items-center justify-between border-b border-border px-4 md:px-6">
        <div className="flex items-center gap-4">
          <Logo />
          <span className="text-sm font-medium text-muted-foreground">Runs</span>
        </div>
        <ConnectionStatus />
      </header>
      <main className="h-[calc(100vh-56px)]">
        <QueryHistory className="h-full" />
      </main>
    </div>
  );
}

export default App;
