import { defineServe } from "@hypequery/serve";
import { z } from "zod";

const api = defineServe({
  basePath: "/api/hypequery",
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
      description: "Demo dataset for the dashboard chart",
      tags: ["metrics"],
    },
    activeUsers: {
      query: async () => ({
        count: 420,
      }),
    },
  },
});

api.route("/metrics/weekly", api.queries.weeklyRevenue);
api.route("/metrics/active-users", api.queries.activeUsers);

export { api };
