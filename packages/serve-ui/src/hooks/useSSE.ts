import { useState, useEffect, useCallback } from 'react';
import { getSSEConnection, type ConnectionState, type SSEEventHandler } from '@/lib/sse';
import type { SSEEventType } from '@/lib/types';

/**
 * Hook for managing SSE connection state.
 */
export function useSSEConnection() {
  const [state, setState] = useState<ConnectionState>('disconnected');
  const connection = getSSEConnection();

  useEffect(() => {
    // Set initial state
    setState(connection.getState());

    // Connect if not already connected
    if (connection.getState() === 'disconnected') {
      connection.connect();
    }

    // Poll for state changes since we can't access the internal callback
    const interval = setInterval(() => {
      const currentState = connection.getState();
      setState((prev) => (currentState !== prev ? currentState : prev));
    }, 500);

    return () => {
      clearInterval(interval);
    };
  }, [connection]);

  const connect = useCallback(() => {
    connection.connect();
  }, [connection]);

  const disconnect = useCallback(() => {
    connection.disconnect();
  }, [connection]);

  return {
    state,
    isConnected: state === 'connected',
    isConnecting: state === 'connecting',
    isError: state === 'error',
    connect,
    disconnect,
  };
}

/**
 * Hook for subscribing to specific SSE events.
 */
export function useSSEEvent<T = unknown>(
  type: SSEEventType | '*',
  handler: SSEEventHandler<T>
) {
  useEffect(() => {
    const connection = getSSEConnection();
    const unsubscribe = connection.on(type, handler);

    return unsubscribe;
  }, [type, handler]);
}
