import { ClickHouseConnection } from '../connection.js';
import { substituteParameters } from '../utils.js';
import { logger } from '../utils/logger.js';
import { createJsonEachRowStream } from '../utils/streaming-helpers.js';
export class ExecutorFeature {
    builder;
    constructor(builder) {
        this.builder = builder;
    }
    toSQLWithParams() {
        const sql = this.toSQLWithoutParameters();
        const config = this.builder.getConfig();
        const parameters = config.parameters || [];
        return { sql, parameters };
    }
    toSQL() {
        const { sql, parameters } = this.toSQLWithParams();
        return substituteParameters(sql, parameters);
    }
    async execute(options) {
        const client = ClickHouseConnection.getClient();
        const { sql, parameters } = this.toSQLWithParams();
        const finalSQL = substituteParameters(sql, parameters);
        const startTime = Date.now();
        logger.logQuery({
            query: finalSQL,
            parameters,
            startTime,
            status: 'started',
            queryId: options?.queryId,
            ...options?.logContext
        });
        try {
            const result = await client.query({
                query: finalSQL,
                format: 'JSONEachRow'
            });
            const rows = await result.json();
            const endTime = Date.now();
            logger.logQuery({
                query: finalSQL,
                parameters,
                startTime,
                endTime,
                duration: endTime - startTime,
                status: 'completed',
                rowCount: rows.length,
                queryId: options?.queryId,
                cacheRowCount: rows.length,
                ...options?.logContext
            });
            return rows;
        }
        catch (error) {
            const endTime = Date.now();
            logger.logQuery({
                query: finalSQL,
                parameters,
                startTime,
                endTime,
                duration: endTime - startTime,
                status: 'error',
                error: error,
                queryId: options?.queryId,
                ...options?.logContext
            });
            throw error;
        }
    }
    async stream() {
        const client = ClickHouseConnection.getClient();
        const { sql, parameters } = this.toSQLWithParams();
        const finalSQL = substituteParameters(sql, parameters);
        const startTime = Date.now();
        logger.logQuery({
            query: finalSQL,
            parameters,
            startTime,
            status: 'started'
        });
        try {
            const result = await client.query({
                query: finalSQL,
                format: 'JSONEachRow'
            });
            const stream = result.stream();
            const webStream = createJsonEachRowStream(stream);
            const endTime = Date.now();
            logger.logQuery({
                query: finalSQL,
                parameters,
                startTime,
                endTime,
                duration: endTime - startTime,
                status: 'completed'
            });
            return webStream;
        }
        catch (error) {
            const endTime = Date.now();
            logger.logQuery({
                query: finalSQL,
                parameters,
                startTime,
                endTime,
                duration: endTime - startTime,
                status: 'error',
                error: error
            });
            throw error;
        }
    }
    toSQLWithoutParameters() {
        const config = this.builder.getConfig();
        const formatter = this.builder.getFormatter();
        const parts = [];
        if (config.ctes?.length) {
            parts.push(`WITH ${config.ctes.join(', ')}`);
        }
        parts.push(`SELECT ${formatter.formatSelect(config)}`);
        parts.push(`FROM ${this.builder.getTableName()}`);
        if (config.joins?.length) {
            parts.push(formatter.formatJoins(config));
        }
        if (config.where?.length) {
            parts.push(`WHERE ${formatter.formatWhere(config)}`);
        }
        if (config.groupBy?.length) {
            parts.push(`GROUP BY ${formatter.formatGroupBy(config)}`);
        }
        if (config.having?.length) {
            parts.push(`HAVING ${config.having.join(' AND ')}`);
        }
        if (config.orderBy?.length) {
            const orderBy = config.orderBy
                .map(({ column, direction }) => `${String(column)} ${direction}`.trim())
                .join(', ');
            parts.push(`ORDER BY ${orderBy}`);
        }
        if (config.limit) {
            const offsetClause = config.offset ? `OFFSET ${config.offset}` : '';
            parts.push(`LIMIT ${config.limit} ${offsetClause}`);
        }
        return parts.join(' ').trim();
    }
}
