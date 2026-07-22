import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { Logo } from '@/components/Logo';
import { Playground } from '@/components/Playground';
import { QueryHistory } from '@/components/QueryHistory';

type Screen = 'playground' | 'runs';

const SCREENS: Array<{ id: Screen; label: string }> = [
  { id: 'playground', label: 'Playground' },
  { id: 'runs', label: 'Runs' },
];

function App() {
  const [screen, setScreen] = useState<Screen>('playground');

  return (
    <div className="h-screen overflow-hidden bg-background">
      <header className="flex h-16 items-center justify-between border-b border-border bg-card/80 px-4 backdrop-blur-md md:px-6">
        <div className="flex items-center gap-4">
          <Logo />
          <nav className="flex items-center gap-1 border-l border-border pl-4">
            {SCREENS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setScreen(id)}
                className={cn(
                  'rounded-md px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.18em] transition-colors',
                  screen === id
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
        <ConnectionStatus />
      </header>
      <main className="h-[calc(100vh-64px)]">
        {screen === 'playground' ? (
          <Playground className="h-full" />
        ) : (
          <QueryHistory className="h-full" />
        )}
      </main>
    </div>
  );
}

export default App;
