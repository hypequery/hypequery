import { defineServe, serveDev } from "@hypequery/serve";
import { z } from "zod";

import { builder, type ApiContext } from "./clickhouse";

const api = defineServe({
  basePath: "/api",
  context: () => (builder ? { db: builder } : {}) satisfies ApiContext,
  queries: {
    weeklyRevenue: {
      query: async () => [
        { week: "2024-01-01", total: 1200 },
        { week: "2024-01-08", total: 980 },
        { week: "2024-01-15", total: 1337 },
      ],
      outputSchema: z.array(
        z.object({
          week: z.string(),
          total: z.number(),
        })
      ),
      tags: ["metrics"],
    },
    activeUsers: {
      query: async () => ({ count: 420 }),
    },
    recentOrders: {
      description: "Latest completed orders pulled from ClickHouse (falls back to mock data)",
      tags: ["orders"],
      query: async ({ ctx }) => {
        if (!ctx.db) {
          return [
            { createdAt: "2024-01-20", amount: 220 },
            { createdAt: "2024-01-18", amount: 145 },
          ];
        }

        const rows = await ctx.db
          .table("orders")
          .select(["created_at", "amount"])
          .where({ status: "completed" })
          .orderBy("created_at", "DESC")
          .limit(5)
          .execute();

        return rows.map((row) => ({
          createdAt: row.created_at,
          amount: row.amount,
        }));
      },
      outputSchema: z.array(
        z.object({
          createdAt: z.string(),
          amount: z.number(),
        })
      ),
    },
  },
});

api.route("/metrics/weekly", api.queries.weeklyRevenue);
api.route("/metrics/active-users", api.queries.activeUsers);
api.route("/orders/recent", api.queries.recentOrders, { visibility: "internal" });

const port = Number(process.env.PORT ?? 4000);

serveDev(api, { port }).then(() => {
  console.log(`API ready on http://localhost:${port}`);
});
