import { initServe, type InferQueryResult } from "@hypequery/serve";

const db = {
  table(_name: string) {
    return {
      select(_cols: string[]) {
        return {
          async limit(_count: number) {
            return [{ trip_id: 1 }];
          },
        };
      },
    };
  },
};

const serve = initServe({ context: () => ({ db }) });
const api = serve.define({
  queries: serve.queries({
    tripsQuery: {
      query: async ({ ctx }) => ctx.db.table("trips").select(["trip_id"]).limit(10),
    },
  }),
});

export type Trips = InferQueryResult<typeof api, "tripsQuery">;

const testTrips: Trips = [{ trip_id: 1 }];
