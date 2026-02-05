class Logger {
    static instance;
    level = 'info';
    enabled = true;
    onQueryLog;
    querySubscribers = new Map();
    constructor() { }
    static getInstance() {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }
    configure(options) {
        if (options.level)
            this.level = options.level;
        if (options.enabled !== undefined)
            this.enabled = options.enabled;
        if (options.onQueryLog)
            this.onQueryLog = options.onQueryLog;
    }
    subscribeToQuery(queryId, callback) {
        if (!this.querySubscribers.has(queryId)) {
            this.querySubscribers.set(queryId, []);
        }
        this.querySubscribers.get(queryId).push(callback);
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
    shouldLog(level) {
        if (!this.enabled)
            return false;
        const levels = ['debug', 'info', 'warn', 'error'];
        return levels.indexOf(level) >= levels.indexOf(this.level);
    }
    debug(message, ...args) {
        if (this.shouldLog('debug')) {
            console.debug(`[hypequery Debug] ${message}`, ...args);
        }
    }
    info(message, ...args) {
        if (this.shouldLog('info')) {
            console.info(`[hypequery Info] ${message}`, ...args);
        }
    }
    warn(message, ...args) {
        if (this.shouldLog('warn')) {
            console.warn(`[hypequery Warn] ${message}`, ...args);
        }
    }
    error(message, ...args) {
        if (this.shouldLog('error')) {
            console.error(`[hypequery Error] ${message}`, ...args);
        }
    }
    logQuery(log) {
        if (!this.enabled)
            return;
        if (this.onQueryLog) {
            this.onQueryLog(log);
        }
        if (log.queryId) {
            const subscribers = this.querySubscribers.get(log.queryId);
            if (subscribers) {
                subscribers.forEach(callback => callback(log));
            }
        }
        const { query, parameters, duration, status, error, rowCount, cacheStatus, cacheKey, cacheMode, cacheAgeMs, cacheRowCount } = log;
        const message = `Query ${status}: ${query}`;
        const details = {
            parameters,
            duration: duration ? `${duration}ms` : undefined,
            rowCount,
            error: error?.message,
            cacheStatus,
            cacheKey,
            cacheMode,
            cacheAgeMs,
            cacheRowCount
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
