import { initServe } from "@hypequery/serve";
import { z } from "zod";

const { define, queries, query } = initServe({ context: () => ({}) });

const api = define({
  queries: queries({
    weeklyRevenue: query
      .describe("Demo dataset for the dashboard chart")
      .output(
        z.array(
          z.object({
            week: z.string(),
            total: z.number(),
          })
        )
      )
      .tag("metrics")
      .query(async () => [
        { week: "2024-01-01", total: 1200 },
        { week: "2024-01-08", total: 980 },
        { week: "2024-01-15", total: 1337 },
      ]),
    activeUsers: query.query(async () => ({ count: 420 })),
  }),
});

api.route("/api/weekly-revenue", api.queries.weeklyRevenue);
api.route("/api/active-users", api.queries.activeUsers);

export { api };
