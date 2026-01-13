/**
 * This file provides a simplified logging interface for the example dashboard.
 * It serves as a placeholder for the actual logger implementation in @hypequery/clickhouse.
 */

// A simple logger interface that mimics the one expected by our example
export interface Logger {
  configure: (options: LoggerOptions) => void;
  subscribeToQuery: (queryId: string, callback: (log: QueryLog) => void) => () => void;
}

export interface LoggerOptions {
  level?: 'debug' | 'info' | 'warn' | 'error';
  enabled?: boolean;
}

export interface QueryLog {
  queryId: string;
  status: 'started' | 'completed' | 'error';
  sql?: string;
  startTime?: number;
  duration?: number;
  rowCount?: number;
  error?: any;
}

/**
 * Creates a simple logger that can be used for demonstration purposes
 */
export function configureLogging(): Logger {
  // In-memory storage for subscribers
  const subscribers: Record<string, ((log: QueryLog) => void)[]> = {};

  // Simple logger implementation
  const logger: Logger = {
    configure: (options: LoggerOptions = {}) => {
      console.log('Logger configured with options:', options);
    },

    subscribeToQuery: (queryId: string, callback: (log: QueryLog) => void) => {
      if (!subscribers[queryId]) {
        subscribers[queryId] = [];
      }

      subscribers[queryId].push(callback);

      // Return unsubscribe function
      return () => {
        subscribers[queryId] = subscribers[queryId].filter(cb => cb !== callback);
        if (subscribers[queryId].length === 0) {
          delete subscribers[queryId];
        }
      };
    }
  };

  return logger;
}

// Example log entry creation for the demo
export function createQueryLog(queryId: string, status: 'started' | 'completed' | 'error', details?: Partial<QueryLog>): QueryLog {
  return {
    queryId,
    status,
    startTime: Date.now(),
    ...details
  };
} 