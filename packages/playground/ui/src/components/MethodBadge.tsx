import { cn } from '@/lib/utils';
import { METHOD_COLORS } from '@/lib/colors';

interface MethodBadgeProps {
  method: string;
  className?: string;
}

/**
 * Reusable badge for displaying HTTP methods with consistent colors.
 */
export function MethodBadge({ method, className }: MethodBadgeProps) {
  const colors = METHOD_COLORS[method.toUpperCase()] || {
    bg: 'bg-gray-100 dark:bg-gray-800',
    text: 'text-gray-700 dark:text-gray-400',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 text-xs font-mono rounded',
        colors.bg,
        colors.text,
        className
      )}
    >
      {method}
    </span>
  );
}

export default MethodBadge;
