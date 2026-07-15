import { useState, useEffect, useCallback, useRef } from 'react';
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

    // Subscribe to state changes (no polling).
    const unsubscribe = connection.onState(setState);

    return unsubscribe;
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
  // Keep the latest handler in a ref so an inline handler does not cause the
  // effect to re-subscribe on every render.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const connection = getSSEConnection();
    const unsubscribe = connection.on<T>(type, (event) => handlerRef.current(event));

    return unsubscribe;
  }, [type]);
}
