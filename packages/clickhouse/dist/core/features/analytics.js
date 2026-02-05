export class AnalyticsFeature {
    builder;
    constructor(builder) {
        this.builder = builder;
    }
    addCTE(alias, subquery) {
        const config = this.builder.getConfig();
        const cte = typeof subquery === 'string' ? subquery : subquery.toSQL();
        return {
            ...config,
            ctes: [...(config.ctes || []), `${alias} AS (${cte})`]
        };
    }
    addTimeInterval(column, interval, method) {
        const config = this.builder.getConfig();
        const groupBy = config.groupBy || [];
        if (method === 'toStartOfInterval') {
            groupBy.push(`${method}(${column}, INTERVAL ${interval})`);
        }
        else {
            groupBy.push(`${method}(${column})`);
        }
        return {
            ...config,
            groupBy
        };
    }
    addSettings(opts) {
        const config = this.builder.getConfig();
        const settingsFragments = Object.entries(opts).map(([key, value]) => `${key}=${value}`);
        return {
            ...config,
            settings: settingsFragments.join(', ')
        };
    }
}
