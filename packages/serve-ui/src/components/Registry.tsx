import { useState } from 'react';
import { RefreshCw, Search, Shield, Clock, Users, X, Code, Tag, ChevronRight } from 'lucide-react';
import { cn, formatDuration } from '@/lib/utils';
import { useRegistry } from '@/hooks/useRegistry';
import type { RegistryEntry } from '@/lib/types';

interface RegistryProps {
  className?: string;
}

/**
 * Registry screen showing all registered endpoints.
 */
export function Registry({ className }: RegistryProps) {
  const { entries, loading, error, refetch } = useRegistry();
  const [search, setSearch] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<RegistryEntry | null>(null);

  const filteredEntries = entries.filter((entry) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      entry.key.toLowerCase().includes(searchLower) ||
      entry.name?.toLowerCase().includes(searchLower) ||
      entry.path.toLowerCase().includes(searchLower) ||
      entry.description?.toLowerCase().includes(searchLower) ||
      entry.tags.some((tag) => tag.toLowerCase().includes(searchLower))
    );
  });

  if (error) {
    return (
      <div className={cn('p-6 text-center', className)}>
        <p className="text-destructive mb-2">Failed to load registry</p>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={() => refetch()}
          className="mt-4 text-sm underline hover:no-underline"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full', className)}>
      {/* List panel */}
      <div className={cn('flex flex-col border-r border-border', selectedEntry ? 'w-1/2' : 'flex-1')}>
        {/* Header */}
        <div className="flex-shrink-0 p-4 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Registry</h2>
              <p className="text-sm text-muted-foreground">
                {entries.length} registered endpoint{entries.length !== 1 ? 's' : ''}
              </p>
            </div>
            <button
              onClick={() => refetch()}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-muted hover:bg-muted/80 rounded-md transition-colors"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </button>
          </div>
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search endpoints..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-muted border-0 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-auto">
          {loading && entries.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              Loading registry...
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {search ? 'No endpoints match your search' : 'No endpoints registered'}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredEntries.map((entry) => (
                <RegistryRow
                  key={entry.key}
                  entry={entry}
                  isSelected={selectedEntry?.key === entry.key}
                  onClick={() => setSelectedEntry(entry)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selectedEntry && (
        <div className="w-1/2 flex flex-col overflow-hidden">
          <RegistryDetail entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
        </div>
      )}
    </div>
  );
}

/**
 * Single registry row.
 */
function RegistryRow({
  entry,
  isSelected,
  onClick,
}: {
  entry: RegistryEntry;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-4 px-4 py-3 cursor-pointer transition-colors',
        'hover:bg-muted/50',
        isSelected && 'bg-muted'
      )}
      onClick={onClick}
    >
      {/* Method badge */}
      <span
        className={cn(
          'flex-shrink-0 px-2 py-0.5 text-xs font-mono rounded',
          entry.method === 'GET' && 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
          entry.method === 'POST' && 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
          entry.method === 'PUT' && 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
          entry.method === 'DELETE' && 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
        )}
      >
        {entry.method}
      </span>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{entry.name || entry.key}</span>
        </div>
        <div className="text-xs text-muted-foreground font-mono truncate">{entry.path}</div>
      </div>

      {/* Badges */}
      <div className="flex-shrink-0 flex items-center gap-1.5">
        {entry.hasTenant && (
          <span className="p-1 rounded bg-purple-100 dark:bg-purple-900/30" title="Tenant-scoped">
            <Users className="h-3 w-3 text-purple-600 dark:text-purple-400" />
          </span>
        )}
        {entry.isCached && (
          <span className="p-1 rounded bg-green-100 dark:bg-green-900/30" title="Cached">
            <Clock className="h-3 w-3 text-green-600 dark:text-green-400" />
          </span>
        )}
        {entry.requiresAuth && (
          <span className="p-1 rounded bg-yellow-100 dark:bg-yellow-900/30" title="Requires Auth">
            <Shield className="h-3 w-3 text-yellow-600 dark:text-yellow-400" />
          </span>
        )}
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </div>
  );
}

/**
 * Registry entry detail view.
 */
function RegistryDetail({ entry, onClose }: { entry: RegistryEntry; onClose: () => void }) {
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'px-2 py-0.5 text-xs font-mono rounded',
              entry.method === 'GET' && 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
              entry.method === 'POST' && 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
            )}
          >
            {entry.method}
          </span>
          <span className="font-medium">{entry.name || entry.key}</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* Path */}
        <section>
          <h3 className="text-sm font-medium mb-2">Path</h3>
          <code className="block bg-muted rounded-md px-3 py-2 text-sm font-mono">{entry.path}</code>
        </section>

        {/* Description */}
        {entry.description && (
          <section>
            <h3 className="text-sm font-medium mb-2">Description</h3>
            <p className="text-sm text-muted-foreground">{entry.description}</p>
          </section>
        )}

        {/* Tags */}
        {entry.tags.length > 0 && (
          <section>
            <h3 className="text-sm font-medium mb-2">Tags</h3>
            <div className="flex flex-wrap gap-2">
              {entry.tags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1 px-2 py-0.5 text-xs bg-muted rounded"
                >
                  <Tag className="h-3 w-3" />
                  {tag}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Input fields */}
        {entry.hasInput && entry.inputFields && entry.inputFields.length > 0 && (
          <section>
            <h3 className="text-sm font-medium mb-2">Input Fields (Allowed Filters)</h3>
            <div className="flex flex-wrap gap-2">
              {entry.inputFields.map((field) => (
                <span
                  key={field}
                  className="flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded font-mono"
                >
                  <Code className="h-3 w-3" />
                  {field}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Capabilities */}
        <section>
          <h3 className="text-sm font-medium mb-2">Capabilities</h3>
          <div className="space-y-2">
            <CapabilityRow
              label="Tenant-scoped"
              enabled={entry.hasTenant}
              icon={Users}
              description="Queries are filtered by tenant ID"
            />
            <CapabilityRow
              label="Cached"
              enabled={entry.isCached}
              icon={Clock}
              description={entry.cacheTtlMs ? `TTL: ${formatDuration(entry.cacheTtlMs)}` : undefined}
            />
            <CapabilityRow
              label="Requires Auth"
              enabled={entry.requiresAuth}
              icon={Shield}
              description={
                entry.requiredRoles?.length
                  ? `Roles: ${entry.requiredRoles.join(', ')}`
                  : entry.requiredScopes?.length
                  ? `Scopes: ${entry.requiredScopes.join(', ')}`
                  : undefined
              }
            />
          </div>
        </section>

        {/* Custom metadata */}
        {entry.custom && Object.keys(entry.custom).length > 0 && (
          <section>
            <h3 className="text-sm font-medium mb-2">Custom Metadata</h3>
            <div className="bg-muted rounded-md p-3">
              <pre className="text-xs font-mono overflow-auto">
                {JSON.stringify(entry.custom, null, 2)}
              </pre>
            </div>
          </section>
        )}

        {/* Visibility */}
        {entry.visibility && (
          <section>
            <h3 className="text-sm font-medium mb-2">Visibility</h3>
            <span
              className={cn(
                'px-2 py-0.5 text-xs rounded',
                entry.visibility === 'public' && 'bg-green-100 dark:bg-green-900/30 text-green-700',
                entry.visibility === 'internal' && 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700',
                entry.visibility === 'private' && 'bg-red-100 dark:bg-red-900/30 text-red-700'
              )}
            >
              {entry.visibility}
            </span>
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * Capability row component.
 */
function CapabilityRow({
  label,
  enabled,
  icon: Icon,
  description,
}: {
  label: string;
  enabled: boolean;
  icon: typeof Shield;
  description?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 p-2 rounded-md',
        enabled ? 'bg-muted' : 'opacity-50'
      )}
    >
      <Icon className={cn('h-4 w-4', enabled ? 'text-primary' : 'text-muted-foreground')} />
      <div className="flex-1">
        <div className="text-sm font-medium">{label}</div>
        {enabled && description && (
          <div className="text-xs text-muted-foreground">{description}</div>
        )}
      </div>
      <span
        className={cn(
          'text-xs px-2 py-0.5 rounded',
          enabled
            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
            : 'bg-muted text-muted-foreground'
        )}
      >
        {enabled ? 'Yes' : 'No'}
      </span>
    </div>
  );
}

export default Registry;
