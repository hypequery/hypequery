import { createClient } from '@clickhouse/client-web';

export class ClickHouseConnection {
	private static instance: ReturnType<typeof createClient>;

	static initialize(config: {
		host: string;
		username?: string;
		password?: string;
		database?: string;
	}): void {
		this.instance = createClient({
			host: config.host,
			username: config.username,
			password: config.password,
			database: config.database,
		});
	}

	static getClient(): ReturnType<typeof createClient> {
		if (!this.instance) {
			throw new Error('ClickHouse connection not initialized');
		}
		return this.instance;
	}
} 