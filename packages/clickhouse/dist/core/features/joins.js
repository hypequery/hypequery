export class JoinFeature {
    builder;
    constructor(builder) {
        this.builder = builder;
    }
    addJoin(type, table, leftColumn, rightColumn, alias) {
        const config = this.builder.getConfig();
        const newConfig = {
            ...config,
            joins: [
                ...(config.joins || []),
                { type, table: String(table), leftColumn: String(leftColumn), rightColumn, alias }
            ]
        };
        return newConfig;
    }
}
