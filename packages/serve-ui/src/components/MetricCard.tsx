import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { COLORS, ICON_SIZES, type ColorScheme } from '@/lib/colors';

interface MetricCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  highlight?: boolean;
  highlightColor?: ColorScheme;
  description?: string;
  className?: string;
}

/**
 * Reusable metric card component for displaying key-value pairs.
 * Used in query details, cache stats, and registry views.
 */
export function MetricCard({
  icon: Icon,
  label,
  value,
  highlight = false,
  highlightColor = 'warning',
  description,
  className,
}: MetricCardProps) {
  const colors = highlight ? COLORS[highlightColor] : null;

  return (
    <div
      className={cn(
        'rounded-md p-3',
        highlight && colors ? `${colors.bgLight} ${colors.text}` : 'bg-muted',
        className
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <Icon className={ICON_SIZES.sm} />
        <span className="text-xs">{label}</span>
      </div>
      <div className={cn('text-lg font-semibold', highlight && colors?.text)}>
        {value}
      </div>
      {description && (
        <div className="text-xs text-muted-foreground mt-1">{description}</div>
      )}
    </div>
  );
}

export default MetricCard;
