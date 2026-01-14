import { initServe } from "@hypequery/serve";
const db = {
    table(_name) {
        return {
            select(_cols) {
                return {
                    async limit(_count) {
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
const testTrips = [{ trip_id: 1 }];
