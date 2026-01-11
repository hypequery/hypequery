import { defineServe } from "@hypequery/serve";

const api = defineServe({
  context: () => ({}),
  queries: {
    exampleMetric: {
      description: "Example metric that always returns true",
      query: async () => ({ ok: true }),
    },
  },
});

// Register routes
api.route("/exampleMetric", api.queries.exampleMetric);

export { api };

/**
 * Embedded usage:
 *   await api.execute("exampleMetric");
 *
 * Optional dev server:
 *   npx hypequery dev lib/api.ts
 */
