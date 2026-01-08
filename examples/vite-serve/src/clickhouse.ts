import { createQueryBuilder } from "@hypequery/clickhouse";
import { createClient } from "@clickhouse/client";

export type DemoSchema = {
  orders: {
    amount: number;
    created_at: string;
    status: string;
  };
};

const url = process.env.CLICKHOUSE_URL;
const username = process.env.CLICKHOUSE_USER ?? "default";
const password = process.env.CLICKHOUSE_PASSWORD ?? "";
const database = process.env.CLICKHOUSE_DATABASE ?? "default";

export const builder = url
  ? createQueryBuilder<DemoSchema>({
      client: createClient({
        url,
        username,
        password,
        database,
      }),
    })
  : null;

export type ApiContext = {
  db?: NonNullable<typeof builder>;
};
