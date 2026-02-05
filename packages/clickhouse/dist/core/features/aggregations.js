export class AggregationFeature {
    builder;
    constructor(builder) {
        this.builder = builder;
    }
    createAggregation(column, fn, alias) {
        const aggregationSQL = `${fn}(${column}) AS ${alias}`;
        const config = this.builder.getConfig();
        if (config.select) {
            return {
                ...config,
                select: [...(config.select || []).map(String), aggregationSQL],
                groupBy: (config.select || []).map(String).filter(col => !col.includes(' AS '))
            };
        }
        return {
            ...config,
            select: [aggregationSQL]
        };
    }
    sum(column, alias) {
        return this.createAggregation(column, 'SUM', alias);
    }
    count(column, alias) {
        return this.createAggregation(column, 'COUNT', alias);
    }
    avg(column, alias) {
        return this.createAggregation(column, 'AVG', alias);
    }
    min(column, alias) {
        return this.createAggregation(column, 'MIN', alias);
    }
    max(column, alias) {
        return this.createAggregation(column, 'MAX', alias);
    }
}
