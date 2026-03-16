import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
}

/**
 * Base skeleton component with shimmer animation.
 */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-muted',
        className
      )}
    />
  );
}

/**
 * Skeleton for a query row in the history list.
 */
export function QueryRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
      {/* Status indicator */}
      <Skeleton className="w-2 h-2 rounded-full" />

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>

      {/* Duration */}
      <Skeleton className="h-4 w-12" />
    </div>
  );
}

/**
 * Skeleton for the query history list.
 */
export function QueryListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div>
      {Array.from({ length: count }).map((_, i) => (
        <QueryRowSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Skeleton for a registry row.
 */
export function RegistryRowSkeleton() {
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-border">
      {/* Method badge */}
      <Skeleton className="h-6 w-12 rounded" />

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>

      {/* Badges */}
      <div className="flex gap-1">
        <Skeleton className="w-6 h-6 rounded" />
        <Skeleton className="w-6 h-6 rounded" />
      </div>
    </div>
  );
}

/**
 * Skeleton for the registry list.
 */
export function RegistryListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div>
      {Array.from({ length: count }).map((_, i) => (
        <RegistryRowSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Skeleton for the playground query selector.
 */
export function PlaygroundSidebarSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="p-4 space-y-2">
      <Skeleton className="h-4 w-24 mb-4" />
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="px-3 py-2 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-10 rounded" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton for the playground main content.
 */
export function PlaygroundContentSkeleton() {
  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-6 w-12 rounded" />
        </div>
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>

      {/* Input form card */}
      <div className="border rounded-lg p-4 space-y-4">
        <div className="space-y-1">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
          <div className="space-y-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        </div>
      </div>

      {/* Execute button */}
      <Skeleton className="h-11 w-full rounded-md" />
    </div>
  );
}

/**
 * Full page loading skeleton.
 */
export function PageSkeleton() {
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-border">
        <Skeleton className="h-6 w-32 mb-2" />
        <Skeleton className="h-4 w-48" />
      </div>

      {/* Content */}
      <div className="flex-1 p-4 space-y-4">
        <Skeleton className="h-10 w-full rounded-md" />
        <QueryListSkeleton count={8} />
      </div>
    </div>
  );
}

export default Skeleton;
