import { ReactNode } from 'react';
import {
  Database,
  Play,
  History,
  BookOpen,
  ExternalLink,
  Search,
  Filter,
  AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  type: 'no-queries' | 'no-history' | 'no-endpoints' | 'no-results' | 'error';
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

const DOCS_URL = 'https://hypequery.dev/docs';

const configs: Record<EmptyStateProps['type'], {
  icon: typeof Database;
  title: string;
  description: string;
  helpLinks?: { label: string; href: string }[];
}> = {
  'no-queries': {
    icon: Database,
    title: 'No queries available',
    description: 'Define queries in your API to start using the playground.',
    helpLinks: [
      { label: 'Creating Queries', href: `${DOCS_URL}/queries` },
      { label: 'Quick Start Guide', href: `${DOCS_URL}/quickstart` },
    ],
  },
  'no-history': {
    icon: History,
    title: 'No query history yet',
    description: 'Query history will appear here as you execute queries through your API.',
    helpLinks: [
      { label: 'Testing Your API', href: `${DOCS_URL}/testing` },
      { label: 'Using the Playground', href: `${DOCS_URL}/playground` },
    ],
  },
  'no-endpoints': {
    icon: Play,
    title: 'No endpoints registered',
    description: 'Register endpoints in your API configuration to see them here.',
    helpLinks: [
      { label: 'Defining Endpoints', href: `${DOCS_URL}/endpoints` },
      { label: 'API Configuration', href: `${DOCS_URL}/configuration` },
    ],
  },
  'no-results': {
    icon: Search,
    title: 'No results found',
    description: 'Try adjusting your search or filters.',
  },
  'error': {
    icon: AlertCircle,
    title: 'Something went wrong',
    description: 'An error occurred while loading data.',
  },
};

/**
 * Empty state component with helpful guidance and documentation links.
 */
export function EmptyState({
  type,
  title,
  description,
  action,
  className
}: EmptyStateProps) {
  const config = configs[type];
  const Icon = config.icon;

  return (
    <div className={cn('flex flex-col items-center justify-center p-8 text-center', className)}>
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-muted-foreground" />
      </div>

      <h3 className="text-lg font-medium mb-2">
        {title || config.title}
      </h3>

      <p className="text-sm text-muted-foreground max-w-sm mb-6">
        {description || config.description}
      </p>

      {action && (
        <div className="mb-6">
          {action}
        </div>
      )}

      {config.helpLinks && config.helpLinks.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            Learn more
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {config.helpLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <BookOpen className="w-4 h-4" />
                {link.label}
                <ExternalLink className="w-3 h-3" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Empty state for filtered results with clear action.
 */
export function FilteredEmptyState({
  onClear,
  className
}: {
  onClear: () => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center p-8 text-center', className)}>
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
        <Filter className="w-6 h-6 text-muted-foreground" />
      </div>

      <h3 className="text-base font-medium mb-1">No results match your filters</h3>

      <p className="text-sm text-muted-foreground mb-4">
        Try adjusting your search or filter criteria
      </p>

      <button
        onClick={onClear}
        className="text-sm text-primary hover:underline"
      >
        Clear all filters
      </button>
    </div>
  );
}

export default EmptyState;
