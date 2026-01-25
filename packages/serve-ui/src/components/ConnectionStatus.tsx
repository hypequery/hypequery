import { Wifi, WifiOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSSEConnection } from '@/hooks/useSSE';

interface ConnectionStatusProps {
  className?: string;
}

/**
 * SSE connection status indicator.
 */
export function ConnectionStatus({ className }: ConnectionStatusProps) {
  const { state, isConnected, isConnecting, isError, connect } = useSSEConnection();

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium',
        isConnected && 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
        isConnecting && 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
        isError && 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
        state === 'disconnected' && !isError && 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
        className
      )}
    >
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
    </div>
  );
}

export default ConnectionStatus;
