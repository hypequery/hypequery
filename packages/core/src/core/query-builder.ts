import { ClickHouseConnection } from './connection.js';

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

export interface QueryConfig<T> {
	select?: Array<keyof T | string>;
	where?: string[];
	groupBy?: keyof T | Array<keyof T>;
	limit?: number;
}

// Simplified QueryBuilder that only needs to know about the result type
export class QueryBuilder<T> {
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
	}> {
		const newBuilder = new QueryBuilder(
			this.tableName,
			this.schema
		);
		newBuilder.config.select = columns;
		//@ts-ignore
		return newBuilder;
	}

	sum<A extends keyof typeof this.originalSchema.columns>(
		column: A
	): QueryBuilder<{
		[P in keyof T | `${A & string}_sum`]: P extends keyof T ? T[P] : number;
	}> {
		const newBuilder = new QueryBuilder<{
			[P in keyof T | `${A & string}_sum`]: P extends keyof T ? T[P] : number;
		}>(
			this.tableName,
			//@ts-ignore
			this.schema,
			this.originalSchema
		);

		if (this.config.select) {
			newBuilder.config.select = [
				...this.config.select,
				`SUM(${String(column)}) AS ${String(column)}_sum`
			];
		} else {
			newBuilder.config.select = [`SUM(${String(column)}) AS ${String(column)}_sum`];
		}
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

	toSQL(): string {
		const parts: string[] = [`SELECT ${this.formatSelect()}`];
		parts.push(`FROM ${this.tableName}`);

		if (this.config.where?.length) {
			parts.push(`WHERE ${this.config.where.join(' AND ')}`);
		}

		if (this.config.groupBy) {
			parts.push(`GROUP BY ${this.formatGroupBy()}`);
		}

		if (this.config.limit) {
			parts.push(`LIMIT ${this.config.limit}`);
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