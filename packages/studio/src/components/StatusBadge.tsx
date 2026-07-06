import { Badge } from './ui/badge';

type Status = 'pending' | 'running' | 'completed' | 'error';

interface StatusBadgeProps {
  status: Status;
  className?: string;
}

const statusVariants: Record<Status, 'warning' | 'info' | 'success' | 'destructive'> = {
  pending: 'warning',
  running: 'info',
  completed: 'success',
  error: 'destructive',
};

const statusLabels: Record<Status, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  error: 'Error',
};

/**
 * Status badge component for query status.
 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <Badge variant={statusVariants[status]} className={className}>
      {status === 'running' && (
        <span className="mr-1.5 h-2 w-2 rounded-full bg-current animate-pulse" />
      )}
      {statusLabels[status]}
    </Badge>
  );
}

export default StatusBadge;
