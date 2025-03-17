export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface QueryLog {
  query: string;
  parameters?: any[];
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'started' | 'completed' | 'error';
  error?: Error;
  rowCount?: number;
  queryId?: string;
}

export interface LoggerOptions {
  level?: LogLevel;
  enabled?: boolean;
  onQueryLog?: (log: QueryLog) => void;
}

class Logger {
  private static instance: Logger;
  private level: LogLevel = 'info';
  private enabled: boolean = true;
  private onQueryLog?: (log: QueryLog) => void;
  private querySubscribers: Map<string, ((log: QueryLog) => void)[]> = new Map();

  private constructor() { }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  configure(options: LoggerOptions): void {
    if (options.level) this.level = options.level;
    if (options.enabled !== undefined) this.enabled = options.enabled;
    if (options.onQueryLog) this.onQueryLog = options.onQueryLog;
  }

  subscribeToQuery(queryId: string, callback: (log: QueryLog) => void): () => void {
    if (!this.querySubscribers.has(queryId)) {
      this.querySubscribers.set(queryId, []);
    }
    this.querySubscribers.get(queryId)!.push(callback);

    return () => {
      const subscribers = this.querySubscribers.get(queryId);
      if (subscribers) {
        const index = subscribers.indexOf(callback);
        if (index > -1) {
          subscribers.splice(index, 1);
        }
        if (subscribers.length === 0) {
          this.querySubscribers.delete(queryId);
        }
      }
    };
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.enabled) return false;
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.debug(`[HypeQuery Debug] ${message}`, ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      console.info(`[HypeQuery Info] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.warn(`[HypeQuery Warn] ${message}`, ...args);
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog('error')) {
      console.error(`[HypeQuery Error] ${message}`, ...args);
    }
  }

  logQuery(log: QueryLog): void {
    if (this.onQueryLog) {
      this.onQueryLog(log);
    }

    if (log.queryId) {
      const subscribers = this.querySubscribers.get(log.queryId);
      if (subscribers) {
        subscribers.forEach(callback => callback(log));
      }
    }

    if (!this.enabled) return;

    const { query, parameters, duration, status, error, rowCount } = log;
    const message = `Query ${status}: ${query}`;
    const details = {
      parameters,
      duration: duration ? `${duration}ms` : undefined,
      rowCount,
      error: error?.message
    };

    switch (status) {
      case 'started':
        this.debug(message, details);
        break;
      case 'completed':
        this.info(message, details);
        break;
      case 'error':
        this.error(message, details);
        break;
    }
  }
}

export const logger = Logger.getInstance(); 