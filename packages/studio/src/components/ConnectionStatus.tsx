import { Wifi, WifiOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSSEConnection } from '@/hooks/useSSE';
import { Badge } from './ui/badge';

interface ConnectionStatusProps {
  className?: string;
}

/**
 * SSE connection status indicator.
 */
export function ConnectionStatus({ className }: ConnectionStatusProps) {
  const { state, isConnected, isConnecting, isError, connect } = useSSEConnection();

  const variant = isConnected
    ? 'success'
    : isConnecting
      ? 'info'
      : isError
        ? 'destructive'
        : 'outline';

  return (
    <Badge variant={variant} className={cn('gap-2 px-3 py-1.5 rounded-full', className)}>
      {isConnected && (
        <>
          <Wifi className="h-3 w-3" />
          <span>Connected</span>
        </>
      )}
      {isConnecting && (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Connecting...</span>
        </>
      )}
      {isError && (
        <>
          <WifiOff className="h-3 w-3" />
          <span>Connection Error</span>
          <button
            onClick={() => connect()}
            className="ml-1 underline hover:no-underline"
          >
            Retry
          </button>
        </>
      )}
      {state === 'disconnected' && !isError && (
        <>
          <WifiOff className="h-3 w-3" />
          <span>Disconnected</span>
          <button
            onClick={() => connect()}
            className="ml-1 underline hover:no-underline"
          >
            Connect
          </button>
        </>
      )}
    </Badge>
  );
}

export default ConnectionStatus;
