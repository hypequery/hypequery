import { cn } from '@/lib/utils';
import { getCacheDisplayConfig } from '@/lib/cache-display';
import type { CacheStatus } from '@/lib/types';

interface CacheBadgeProps {
  status?: CacheStatus;
  cacheHit?: boolean;
  showIcon?: boolean;
  variant?: 'default' | 'compact';
  className?: string;
}

/**
 * Reusable badge for displaying cache status.
 * Uses shared cache display config for consistent styling.
 */
export function CacheBadge({
  status,
  cacheHit,
  showIcon = false,
  variant = 'default',
  className,
}: CacheBadgeProps) {
  const config = getCacheDisplayConfig(status, cacheHit);

  if (!config) {
    return null;
  }

  const Icon = config.icon;
  const label = variant === 'compact' ? config.labelShort : config.label;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded',
        config.className,
        className
      )}
    >
      {showIcon && <Icon className="h-3 w-3" />}
      {label}
    </span>
  );
}

export default CacheBadge;
