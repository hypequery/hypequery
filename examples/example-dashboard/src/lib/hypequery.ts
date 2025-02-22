import { createQueryBuilder } from "@hypequery/core"
import type { IntrospectedSchema } from "@/types/clickhouse-schema"

export const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.NEXT_PUBLIC_CLICKHOUSE_HOST || "http://localhost:8123",
  username: process.env.NEXT_PUBLIC_CLICKHOUSE_USER || "default",
  password: process.env.NEXT_PUBLIC_CLICKHOUSE_PASSWORD,
  database: process.env.NEXT_PUBLIC_CLICKHOUSE_DATABASE || "default",
}) 