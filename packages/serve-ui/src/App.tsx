import { useState } from 'react';
import { History, BarChart3, Database, Settings, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QueryHistory } from '@/components/QueryHistory';
import { CacheStats } from '@/components/CacheStats';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarToggle,
  SidebarNav,
  SidebarNavItem,
  SidebarGroup,
  useSidebar,
} from '@/components/ui';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/select';

type View = 'queries' | 'cache' | 'endpoints' | 'settings';

const NAV_ITEMS: Array<{ id: View; label: string; icon: typeof History }> = [
  { id: 'queries', label: 'Query History', icon: History },
  { id: 'cache', label: 'Cache Stats', icon: BarChart3 },
  { id: 'endpoints', label: 'Endpoints', icon: Database },
  { id: 'settings', label: 'Settings', icon: Settings },
];

/**
 * Main application shell with collapsible sidebar.
 */
function App() {
  return (
    <SidebarProvider defaultCollapsed={false}>
      <AppContent />
    </SidebarProvider>
  );
}

function AppContent() {
  const [activeView, setActiveView] = useState<View>('queries');
  const { isCollapsed } = useSidebar();

  return (
    <div className="h-screen flex bg-background">
      {/* Collapsible Sidebar */}
      <Sidebar>
        <SidebarHeader>
          {!isCollapsed ? (
            <>
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                <span className="font-semibold">
                  <span className="text-primary">Hype</span>Query
                </span>
              </div>
              <SidebarToggle />
            </>
          ) : (
            <Zap className="h-5 w-5 text-primary" />
          )}
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup label="Navigation">
            <SidebarNav>
              {NAV_ITEMS.map((item) => (
                <SidebarNavItem
                  key={item.id}
                  icon={item.icon}
                  isActive={activeView === item.id}
                  onClick={() => setActiveView(item.id)}
                  tooltip={item.label}
                >
                  {item.label}
                </SidebarNavItem>
              ))}
            </SidebarNav>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          {isCollapsed ? (
            <SidebarToggle className="w-full" />
          ) : (
            <div className="px-1">
              <ConnectionStatus />
            </div>
          )}
        </SidebarFooter>
      </Sidebar>

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex-shrink-0 h-14 border-b border-border flex items-center justify-between px-6">
          <h1 className="text-lg font-semibold">
            {NAV_ITEMS.find((item) => item.id === activeView)?.label}
          </h1>
          {isCollapsed && <ConnectionStatus />}
        </header>

        {/* Content */}
        <main className="flex-1 overflow-hidden">
          {activeView === 'queries' && <QueryHistory className="h-full" />}
          {activeView === 'cache' && <CacheStats className="h-full overflow-auto" />}
          {activeView === 'endpoints' && <EndpointsView />}
          {activeView === 'settings' && <SettingsView />}
        </main>
      </div>
    </div>
  );
}

/**
 * Endpoints view placeholder.
 */
function EndpointsView() {
  return (
    <div className="p-6">
      <Card>
        <CardHeader>
          <CardTitle>Available Endpoints</CardTitle>
          <CardDescription>
            View and test your API endpoints here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted rounded-md p-8 text-center text-muted-foreground">
            <Database className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Endpoint explorer coming soon...</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Settings view.
 */
function SettingsView() {
  return (
    <div className="p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Theme</CardTitle>
          <CardDescription>
            Choose your preferred color scheme.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select defaultValue="system" className="w-48">
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Auto-refresh</CardTitle>
          <CardDescription>
            Automatically refresh query list.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              defaultChecked
              className="h-4 w-4 rounded border-input"
            />
            <span className="text-sm">Enable auto-refresh</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data Management</CardTitle>
          <CardDescription>
            Export or import query history.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <button
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-md',
              'bg-secondary text-secondary-foreground hover:bg-secondary/80',
              'transition-colors'
            )}
          >
            Export History
          </button>
          <button
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-md',
              'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
              'transition-colors'
            )}
          >
            Import History
          </button>
        </CardContent>
      </Card>
    </div>
  );
}

export default App;
