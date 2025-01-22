import { ClickHouseConnection } from './connection.js';
import { TableSchema, QueryConfig, WhereExpression, GroupByExpression, ColumnType, TableRecord } from './types.js';


export function createQueryBuilder<T extends { [tableName: string]: { [columnName: string]: ColumnType | "String" | "Date" | "Float64" } }

>(config: {
	host: string;
	username?: string;
	password?: string;
	database?: string;
}) {
	ClickHouseConnection.initialize(config);

	return {
		table<TableName extends keyof T>(
			tableName: TableName
		): QueryBuilder<T[TableName]> {
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

export class QueryBuilder<T> {
	private config: QueryConfig<T> = {};
	private tableName: string;
	private schema: TableSchema<T>;

	constructor(tableName: string, schema: TableSchema<T>) {
		this.tableName = tableName;
		this.schema = schema;
	}

	select<K extends keyof T>(columns: K[]): QueryBuilder<{ [P in K]: T[P] }> {
		const newBuilder = new QueryBuilder<{ [P in K]: T[P] }>(
			this.tableName,
			{ name: this.schema.name, columns: this.schema.columns }
		);
		newBuilder.config.select = columns;
		return newBuilder;
	}

	where(condition: WhereExpression): this {
		this.config.where = this.config.where || [];
		this.config.where.push(condition);
		return this;
	}

	groupBy(columns: GroupByExpression<T>): this {
		this.config.groupBy = columns;
		return this;
	}

	limit(count: number): this {
		this.config.limit = count;
		return this;
	}

	private formatSelect(): string {
		if (!this.config.select?.length) return '*';

		return this.config.select.map(expr => {
			if (typeof expr === 'string' || typeof expr === 'number') {
				return String(expr);
			}
			return Object.entries(expr)
				.map(([alias, value]) => `${value} AS ${alias}`)
				.join(', ');
		}).join(', ');
	}

	private formatGroupBy(groupBy: GroupByExpression<T>): string {
		if (Array.isArray(groupBy)) {
			return groupBy.map(String).join(', ');
		}
		return String(groupBy);
	}

	toSQL(): string {
		const parts: string[] = [`SELECT ${this.formatSelect()}`];
		parts.push(`FROM ${this.tableName}`);

		if (this.config.where?.length) {
			parts.push(`WHERE ${this.config.where.join(' AND ')}`);
		}

		if (this.config.groupBy) {
			parts.push(`GROUP BY ${this.formatGroupBy(this.config.groupBy)}`);
		}

		if (this.config.limit) {
			parts.push(`LIMIT ${this.config.limit}`);
		}

		return parts.join(' ');
	}

	async execute(): Promise<TableRecord<T>[]> {
		const client = ClickHouseConnection.getClient();
		const result = await client.query({
			query: this.toSQL(),
			format: 'JSONEachRow'
		});

		return result.json<TableRecord<T>[]>();
	}
} 