import { ClickHouseConnection } from './connection';

type ColumnToTS<T> = T extends 'String' ? string :
	T extends 'Date' ? Date :
	T extends 'Float64' | 'Int32' | 'Int64' ? number :
	never;

export type OrderDirection = 'ASC' | 'DESC';

export interface QueryConfig<T> {
	select?: Array<keyof T | string>;
	where?: string[];
	groupBy?: string[];
	limit?: number;
	orderBy?: Array<{
		column: keyof T;
		direction: OrderDirection;
	}>;
}

// Simplified QueryBuilder that only needs to know about the result type
export class QueryBuilder<T, HasSelect extends boolean = false, Aggregations = {}> {
	private config: QueryConfig<T> = {};
	private tableName: string;
	private schema: { name: string; columns: T };
	private originalSchema: { name: string; columns: any };

	constructor(
		tableName: string,
		schema: { name: string; columns: T },
		originalSchema?: { name: string; columns: any }
	) {
		this.tableName = tableName;
		this.schema = schema;
		this.originalSchema = originalSchema || schema;
	}

	debug() {
		console.log('Current Type:', {
			schema: this.schema,
			originalSchema: this.originalSchema,
			config: this.config
		});
		return this;
	}


	select<K extends keyof T>(columns: K[]): QueryBuilder<{
		[P in K]: T[P] extends 'String' ? string :
		T[P] extends 'Date' ? Date :
		T[P] extends 'Float64' | 'Int32' | 'Int64' ? number : never;
	}, true> {
		const newBuilder = new QueryBuilder(
			this.tableName,
			this.schema
		)
		newBuilder.config.select = columns;
		return newBuilder
	}

	private createAggregation<A extends keyof typeof this.originalSchema.columns, S extends string>(
		column: A,
		fn: string,
		suffix: S
	): QueryBuilder<
		HasSelect extends false
		? Aggregations & Record<`${string & A}_${S}`, string>
		: { [P in keyof T | `${string & A}_${S}`]: P extends keyof T ? T[P] : string },
		HasSelect,
		Aggregations & Record<`${string & A}_${S}`, string>
	> {
		const newBuilder = new QueryBuilder(
			this.tableName,
			this.schema,
			this.originalSchema
		) as any;

		if (this.config.select) {
			newBuilder.config.select = [
				...(this.config.select as string[]),
				`${fn}(${String(column)}) AS ${String(column)}_${suffix}`
			];
			newBuilder.config.groupBy = (this.config.select as string[]).filter(col => !col.includes(' AS '));
		} else {
			newBuilder.config.select = [`${fn}(${String(column)}) AS ${String(column)}_${suffix}`];
		}

		return newBuilder;
	}

	sum<A extends keyof typeof this.originalSchema.columns>(column: A) {
		return this.createAggregation(column, 'SUM', 'sum' as const);
	}

	count<A extends keyof typeof this.originalSchema.columns>(column: A) {
		return this.createAggregation(column, 'COUNT', 'count' as const);
	}

	avg<A extends keyof typeof this.originalSchema.columns>(column: A) {
		return this.createAggregation(column, 'AVG', 'avg' as const);
	}

	min<A extends keyof typeof this.originalSchema.columns>(column: A) {
		return this.createAggregation(column, 'MIN', 'min' as const);
	}

	max<A extends keyof typeof this.originalSchema.columns>(column: A) {
		return this.createAggregation(column, 'MAX', 'max' as const);
	}

	async execute(): Promise<T[]> {
		const client = ClickHouseConnection.getClient();
		const result = await client.query({
			query: this.toSQL(),
			format: 'JSONEachRow'
		});

		return result.json<T[]>();
	}

	where(condition: string): this {
		this.config.where = this.config.where || [];
		this.config.where.push(condition);
		return this;
	}

	groupBy(columns: keyof T | Array<keyof T>): this {
		this.config.groupBy = Array.isArray(columns)
			? columns.map(String)
			: [String(columns)];
		return this;
	}

	limit(count: number): this {
		this.config.limit = count;
		return this;
	}

	orderBy(column: keyof T, direction: OrderDirection = 'ASC'): this {
		this.config.orderBy = this.config.orderBy || [];
		this.config.orderBy.push({ column, direction });
		return this;
	}

	toSQL(): string {
		const parts: string[] = [`SELECT ${this.formatSelect()}`];
		parts.push(`FROM ${this.tableName}`);

		if (this.config.where?.length) {
			parts.push(`WHERE ${this.config.where.join(' AND ')}`);
		}

		if (this.config.groupBy?.length) {
			parts.push(`GROUP BY ${this.formatGroupBy()}`);
		}

		if (this.config.limit) {
			parts.push(`LIMIT ${this.config.limit}`);
		}

		if (this.config.orderBy?.length) {
			const orderBy = this.config.orderBy
				.map(({ column, direction }) => `${String(column)} ${direction}`)
				.join(', ');
			parts.push(`ORDER BY ${orderBy}`);
		}

		return parts.join(' ');
	}

	private formatSelect(): string {
		if (!this.config.select?.length) return '*';
		return this.config.select.join(', ');
	}

	private formatGroupBy(): string {
		const groupBy = this.config.groupBy;
		if (Array.isArray(groupBy)) {
			return groupBy.join(', ');
		}
		return String(groupBy);
	}

}

export function createQueryBuilder<T extends { [tableName: string]: { [columnName: string]: ColumnToTS<any> } }>(
	config: {
		host: string;
		username?: string;
		password?: string;
		database?: string;
	}
) {
	ClickHouseConnection.initialize(config);

	return {
		table<TableName extends keyof T>(tableName: TableName): QueryBuilder<T[TableName]> {
			return new QueryBuilder<T[TableName]>(
				tableName as string,
				{
					name: tableName as string,
					columns: {} as T[TableName]
				}
			);
		}
	};
}