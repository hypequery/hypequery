import { cn } from '@/lib/utils';
import { COLORS } from '@/lib/colors';

interface TenantBadgeProps {
  tenantId: string;
  className?: string;
}

/**
 * Reusable badge for displaying tenant information.
 */
export function TenantBadge({ tenantId, className }: TenantBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center text-xs font-medium px-2 py-0.5 rounded',
        COLORS.purple.bg,
        COLORS.purple.text,
        className
      )}
    >
      {tenantId}
    </span>
  );
}

export default TenantBadge;
