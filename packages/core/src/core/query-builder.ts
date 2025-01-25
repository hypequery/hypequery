import { ClickHouseConnection } from './connection';

// Base type for converting ClickHouse types
type ColumnToTS<T> = T extends 'String' ? string :
	T extends 'Date' ? Date :
	T extends 'Float64' | 'Int32' | 'Int64' ? number :
	never;

// Type for selected columns
type Selected<T, K extends keyof T> = {
	[P in K]: T[P];
};

// Type for aggregated column
type Aggregated<K extends string> = {
	[P in `${K}_sum`]: number;
};

// Combined type for results
type QueryResult<T, K extends keyof T, A extends keyof T> = Selected<T, K> & Aggregated<string & A>;
// Type that adds aggregations to selected columns
type WithAggregations<T, K extends keyof T, A extends keyof T> = Selected<T, K> & Aggregated<string & A>;

export type OrderDirection = 'ASC' | 'DESC';

export interface QueryConfig<T> {
	select?: Array<keyof T | string>;
	where?: string[];
	groupBy?: keyof T | Array<keyof T>;
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
		);
		newBuilder.config.select = columns;
		return newBuilder;
	}

	sum<A extends keyof typeof this.originalSchema.columns>(
		column: A
	): QueryBuilder<
		HasSelect extends false
		? Aggregations & Record<`${string & A}_sum`, string>
		: { [P in keyof T | `${string & A}_sum`]: P extends keyof T ? T[P] : string },
		HasSelect,
		Aggregations & Record<`${string & A}_sum`, string>
	> {
		// Create new schema with only the sum column if no columns are selected
		const newSchema = {
			name: this.schema.name,
			columns: this.config.select ? this.schema.columns : {} as Record<`${string & A}_sum`, string>
		};

		const newBuilder = new QueryBuilder(
			this.tableName,
			newSchema,
			this.originalSchema
		);

		if (this.config.select) {
			newBuilder.config.select = [
				// @ts-ignore
				...this.config.select,
				// @ts-ignore
				`SUM(${String(column)}) AS ${String(column)}_sum`
			];
			// @ts-ignore
			newBuilder.config.groupBy = this.config.select.filter(col => !col.includes(' AS '));
		} else {
			newBuilder.config.select = [`SUM(${String(column)}) AS ${String(column)}_sum`];
		}
		// @ts-ignore
		return newBuilder;
	}

	count<A extends keyof typeof this.originalSchema.columns>(
		column: A
	): QueryBuilder<
		HasSelect extends false
		? Aggregations & Record<`${string & A}_count`, string>
		: { [P in keyof T | `${string & A}_count`]: P extends keyof T ? T[P] : string },
		HasSelect,
		Aggregations & Record<`${string & A}_count`, string>
	> {
		const newBuilder = new QueryBuilder(
			this.tableName,
			this.schema,
			this.originalSchema
		);

		if (this.config.select) {
			newBuilder.config.select = [
				...this.config.select,
				`COUNT(${String(column)}) AS ${String(column)}_count`
			];
			// @ts-ignore
			// Only use original selected columns for GROUP BY
			newBuilder.config.groupBy = this.config.select.filter(col => !col.includes(' AS '));
		} else {
			newBuilder.config.select = [`COUNT(${String(column)}) AS ${String(column)}_count`];
		}
		// @ts-ignore
		return newBuilder;
	}

	avg<A extends keyof typeof this.originalSchema.columns>(
		column: A
	): QueryBuilder<
		HasSelect extends false
		? Aggregations & Record<`${string & A}_avg`, string>
		: { [P in keyof T | `${string & A}_avg`]: P extends keyof T ? T[P] : string },
		HasSelect,
		Aggregations & Record<`${string & A}_avg`, string>
	> {
		const newBuilder = new QueryBuilder(
			this.tableName,
			this.schema,
			this.originalSchema
		);

		if (this.config.select) {
			newBuilder.config.select = [
				...this.config.select,
				`AVG(${String(column)}) AS ${String(column)}_avg`
			];
			// @ts-ignore
			newBuilder.config.groupBy = this.config.select.filter(col => !col.includes(' AS '));
		} else {
			newBuilder.config.select = [`AVG(${String(column)}) AS ${String(column)}_avg`];
		}
		// @ts-ignore
		return newBuilder;
	}

	min<A extends keyof typeof this.originalSchema.columns>(
		column: A
	): QueryBuilder<
		HasSelect extends false
		? Aggregations & Record<`${string & A}_min`, string>
		: { [P in keyof T | `${string & A}_min`]: P extends keyof T ? T[P] : string },
		HasSelect,
		Aggregations & Record<`${string & A}_min`, string>
	> {
		const newBuilder = new QueryBuilder(
			this.tableName,
			this.schema,
			this.originalSchema
		);

		if (this.config.select) {
			newBuilder.config.select = [
				...this.config.select,
				`MIN(${String(column)}) AS ${String(column)}_min`
			];
			// @ts-ignore
			newBuilder.config.groupBy = this.config.select.filter(col => !col.includes(' AS '));
		} else {
			newBuilder.config.select = [`MIN(${String(column)}) AS ${String(column)}_min`];
		}
		// @ts-ignore
		return newBuilder;
	}

	max<A extends keyof typeof this.originalSchema.columns>(
		column: A
	): QueryBuilder<
		HasSelect extends false
		? Aggregations & Record<`${string & A}_max`, string>
		: { [P in keyof T | `${string & A}_max`]: P extends keyof T ? T[P] : string },
		HasSelect,
		Aggregations & Record<`${string & A}_max`, string>
	> {
		const newBuilder = new QueryBuilder(
			this.tableName,
			this.schema,
			this.originalSchema
		);

		if (this.config.select) {
			newBuilder.config.select = [
				...this.config.select,
				`MAX(${String(column)}) AS ${String(column)}_max`
			];
			// @ts-ignore
			newBuilder.config.groupBy = this.config.select.filter(col => !col.includes(' AS '));
		} else {
			newBuilder.config.select = [`MAX(${String(column)}) AS ${String(column)}_max`];
		}
		// @ts-ignore
		return newBuilder;
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
		this.config.groupBy = columns;
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

		//@ts-ignore
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