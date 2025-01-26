import { ClickHouseConnection } from './connection';
import { FilterOperator } from './types';

type ColumnToTS<T> = T extends 'String' ? string :
	T extends 'Date' ? Date :
	T extends 'Float64' | 'Int32' | 'Int64' ? number :
	never;

export type OrderDirection = 'ASC' | 'DESC';

type WhereType = 'AND' | 'OR';

interface WhereCondition {
	column: string;
	operator: FilterOperator;
	value: any;
	conjunction: 'AND' | 'OR';
}

export interface QueryConfig<T> {
	select?: Array<keyof T | string>;
	where?: WhereCondition[];
	groupBy?: string[];
	having?: string[];
	limit?: number;
	offset?: number;
	distinct?: boolean;
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
		[P in K]: T[P] extends "String" ? string :
		T[P] extends "Date" ? Date :
		T[P] extends "Float64" | "Int32" | "Int64" ? number : never;
	}, true, {}> {
		type NewT = {
			[P in K]: T[P] extends "String" ? string :
			T[P] extends "Date" ? Date :
			T[P] extends "Float64" | "Int32" | "Int64" ? number : never;
		};

		const newBuilder = new QueryBuilder<NewT, true>(
			this.tableName,
			{ name: this.schema.name, columns: {} as NewT },
			this.originalSchema
		);
		newBuilder.config = { ...this.config, select: columns as string[] } as QueryConfig<NewT>;
		return newBuilder;
	}

	private createAggregation<A extends keyof typeof this.originalSchema.columns, S extends string>(
		column: A,
		fn: string,
		suffix: S
	): QueryBuilder<
		HasSelect extends false
		? { [K in `${A & string}_${S}` | keyof Aggregations]: string }
		: { [P in keyof T | `${string & A}_${S}`]: P extends keyof T ? T[P] : string },
		HasSelect,
		{ [K in `${A & string}_${S}` | keyof Aggregations]: string }  // Merge into single type
	> {
		const newBuilder = new QueryBuilder(
			this.tableName,
			this.schema,
			this.originalSchema
		) as any;

		// Copy existing config including distinct flag
		newBuilder.config = { ...this.config };

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

	where<K extends keyof typeof this.originalSchema.columns>(
		column: K,
		operator: FilterOperator,
		value: any
	): this {
		this.config.where = this.config.where || [];
		this.config.where.push({
			column: String(column),
			operator,
			value,
			conjunction: 'AND'
		});
		return this;
	}

	orWhere<K extends keyof typeof this.originalSchema.columns>(
		column: K,
		operator: FilterOperator,
		value: any
	): this {
		this.config.where = this.config.where || [];
		this.config.where.push({
			column: String(column),
			operator,
			value,
			conjunction: 'OR'
		});
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

	offset(count: number): this {
		this.config.offset = count;
		return this;
	}

	orderBy(column: keyof T, direction: OrderDirection = 'ASC'): this {
		this.config.orderBy = this.config.orderBy || [];
		this.config.orderBy.push({ column, direction });
		return this;
	}

	having(condition: string): this {
		this.config.having = this.config.having || [];
		this.config.having.push(condition);
		return this;
	}

	distinct(): this {
		this.config.distinct = true;
		return this;
	}

	whereBetween(
		column: keyof typeof this.originalSchema.columns,
		[min, max]: [number | string | Date, number | string | Date]
	): this {
		if (min === null || max === null) {
			throw new Error('BETWEEN values cannot be null');
		}
		return this.where(column, 'between', [min, max]);
	}

	toSQL(): string {
		const parts: string[] = [`SELECT ${this.formatSelect()}`];
		parts.push(`FROM ${this.tableName}`);

		if (this.config.where?.length) {
			parts.push(`WHERE ${this.formatWhere()}`);
		}

		if (this.config.groupBy?.length) {
			parts.push(`GROUP BY ${this.formatGroupBy()}`);
		}

		if (this.config.having?.length) {
			parts.push(`HAVING ${this.config.having.join(' AND ')}`);
		}

		if (this.config.orderBy?.length) {
			const orderBy = this.config.orderBy
				.map(({ column, direction }) => `${String(column)} ${direction}`)
				.join(', ');
			parts.push(`ORDER BY ${orderBy}`);
		}

		if (this.config.limit) {
			const offsetClause = this.config.offset ? ` OFFSET ${this.config.offset}` : '';
			parts.push(`LIMIT ${this.config.limit}${offsetClause}`);
		}

		return parts.join(' ');
	}

	private formatSelect(): string {
		const distinctClause = this.config.distinct ? 'DISTINCT ' : '';
		if (!this.config.select?.length) return distinctClause + '*';
		return distinctClause + this.config.select.join(', ');
	}

	private formatGroupBy(): string {
		const groupBy = this.config.groupBy;
		if (Array.isArray(groupBy)) {
			return groupBy.join(', ');
		}
		return String(groupBy);
	}

	private formatWhere(): string {
		if (!this.config.where?.length) return '';

		return this.config.where
			.map((condition, index) => {
				const { column, operator, value, conjunction } = condition;
				const prefix = index === 0 ? '' : ` ${conjunction}`;

				switch (operator) {
					case 'eq':
						return `${prefix} ${column} = ${this.formatValue(value)}`.trim();
					case 'neq':
						return `${prefix} ${column} != ${this.formatValue(value)}`.trim();
					case 'gt':
						return `${prefix} ${column} > ${this.formatValue(value)}`.trim();
					case 'gte':
						return `${prefix} ${column} >= ${this.formatValue(value)}`.trim();
					case 'lt':
						return `${prefix} ${column} < ${this.formatValue(value)}`.trim();
					case 'lte':
						return `${prefix} ${column} <= ${this.formatValue(value)}`.trim();
					case 'like':
						return `${prefix} ${column} LIKE ${this.formatValue(value)}`.trim();
					case 'in':
						return `${prefix} ${column} IN (${(value as any[]).map(v => this.formatValue(v)).join(', ')})`.trim();
					case 'notIn':
						return `${prefix} ${column} NOT IN (${(value as any[]).map(v => this.formatValue(v)).join(', ')})`.trim();
					case 'between':
						const [min, max] = value as [any, any];
						return `${prefix} ${column} BETWEEN ${this.formatValue(min)} AND ${this.formatValue(max)}`.trim();
					default:
						throw new Error(`Unsupported operator: ${operator}`);
				}
			})
			.join(' ');
	}

	private formatValue(value: any): string {
		if (value === null) return 'NULL';
		if (typeof value === 'string') return `'${value}'`;
		if (value instanceof Date) return value.toISOString().split('T')[0];
		return String(value);
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