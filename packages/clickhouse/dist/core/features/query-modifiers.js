export class QueryModifiersFeature {
    builder;
    constructor(builder) {
        this.builder = builder;
    }
    addGroupBy(columns) {
        const config = this.builder.getConfig();
        return {
            ...config,
            groupBy: Array.isArray(columns) ? columns.map(String) : [String(columns)]
        };
    }
    addLimit(count) {
        const config = this.builder.getConfig();
        return {
            ...config,
            limit: count
        };
    }
    addOffset(count) {
        const config = this.builder.getConfig();
        return {
            ...config,
            offset: count
        };
    }
    addOrderBy(column, direction = 'ASC') {
        const config = this.builder.getConfig();
        return {
            ...config,
            orderBy: [...(config.orderBy || []), { column, direction }]
        };
    }
    addHaving(condition, parameters) {
        const config = this.builder.getConfig();
        const having = [...(config.having || []), condition];
        const newParams = parameters ? [...(config.parameters || []), ...parameters] : config.parameters;
        return {
            ...config,
            having,
            parameters: newParams
        };
    }
    setDistinct() {
        const config = this.builder.getConfig();
        return {
            ...config,
            distinct: true
        };
    }
}
