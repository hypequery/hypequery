// api/queries.ts
import { initServe } from "@hypequery/serve";
import { z } from "zod";
var { define, queries, query } = initServe({
  context: () => ({}),
  basePath: "/api"
});
var api = define({
  queries: queries({
    hello: query.describe("Simple hello world query").input(z.void()).output(z.object({
      message: z.string(),
      timestamp: z.string()
    })).query(async () => ({
      message: "Hello from hypequery + Vite!",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    })),
    stats: query.describe("Get some example stats").input(z.void()).output(z.object({
      users: z.number(),
      revenue: z.number(),
      growth: z.number()
    })).query(async () => ({
      users: 1337,
      revenue: 98765,
      growth: 23.5
    }))
  })
});
api.route("/hello", api.queries.hello, { method: "GET" }).route("/stats", api.queries.stats, { method: "GET" });
export {
  api
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiYXBpL3F1ZXJpZXMudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7IGluaXRTZXJ2ZSB9IGZyb20gJ0BoeXBlcXVlcnkvc2VydmUnO1xuaW1wb3J0IHsgeiB9IGZyb20gJ3pvZCc7XG5cbmNvbnN0IHsgZGVmaW5lLCBxdWVyaWVzLCBxdWVyeSB9ID0gaW5pdFNlcnZlKHtcbiAgY29udGV4dDogKCkgPT4gKHt9KSxcbiAgYmFzZVBhdGg6ICcvYXBpJ1xufSk7XG5cbmV4cG9ydCBjb25zdCBhcGkgPSBkZWZpbmUoe1xuICBxdWVyaWVzOiBxdWVyaWVzKHtcbiAgICBoZWxsbzogcXVlcnlcbiAgICAgIC5kZXNjcmliZSgnU2ltcGxlIGhlbGxvIHdvcmxkIHF1ZXJ5JylcbiAgICAgIC5pbnB1dCh6LnZvaWQoKSlcbiAgICAgIC5vdXRwdXQoei5vYmplY3Qoe1xuICAgICAgICBtZXNzYWdlOiB6LnN0cmluZygpLFxuICAgICAgICB0aW1lc3RhbXA6IHouc3RyaW5nKCksXG4gICAgICB9KSlcbiAgICAgIC5xdWVyeShhc3luYyAoKSA9PiAoe1xuICAgICAgICBtZXNzYWdlOiAnSGVsbG8gZnJvbSBoeXBlcXVlcnkgKyBWaXRlIScsXG4gICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSkpLFxuXG4gICAgc3RhdHM6IHF1ZXJ5XG4gICAgICAuZGVzY3JpYmUoJ0dldCBzb21lIGV4YW1wbGUgc3RhdHMnKVxuICAgICAgLmlucHV0KHoudm9pZCgpKVxuICAgICAgLm91dHB1dCh6Lm9iamVjdCh7XG4gICAgICAgIHVzZXJzOiB6Lm51bWJlcigpLFxuICAgICAgICByZXZlbnVlOiB6Lm51bWJlcigpLFxuICAgICAgICBncm93dGg6IHoubnVtYmVyKCksXG4gICAgICB9KSlcbiAgICAgIC5xdWVyeShhc3luYyAoKSA9PiAoe1xuICAgICAgICB1c2VyczogMTMzNyxcbiAgICAgICAgcmV2ZW51ZTogOTg3NjUsXG4gICAgICAgIGdyb3d0aDogMjMuNSxcbiAgICAgIH0pKSxcbiAgfSksXG59KTtcblxuLy8gUmVnaXN0ZXIgcm91dGVzXG5hcGlcbiAgLnJvdXRlKCcvaGVsbG8nLCBhcGkucXVlcmllcy5oZWxsbywgeyBtZXRob2Q6ICdHRVQnIH0pXG4gIC5yb3V0ZSgnL3N0YXRzJywgYXBpLnF1ZXJpZXMuc3RhdHMsIHsgbWV0aG9kOiAnR0VUJyB9KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBQSxTQUFTLGlCQUFpQjtBQUMxQixTQUFTLFNBQVM7QUFFbEIsSUFBTSxFQUFFLFFBQVEsU0FBUyxNQUFNLElBQUksVUFBVTtBQUFBLEVBQzNDLFNBQVMsT0FBTyxDQUFDO0FBQUEsRUFDakIsVUFBVTtBQUNaLENBQUM7QUFFTSxJQUFNLE1BQU0sT0FBTztBQUFBLEVBQ3hCLFNBQVMsUUFBUTtBQUFBLElBQ2YsT0FBTyxNQUNKLFNBQVMsMEJBQTBCLEVBQ25DLE1BQU0sRUFBRSxLQUFLLENBQUMsRUFDZCxPQUFPLEVBQUUsT0FBTztBQUFBLE1BQ2YsU0FBUyxFQUFFLE9BQU87QUFBQSxNQUNsQixXQUFXLEVBQUUsT0FBTztBQUFBLElBQ3RCLENBQUMsQ0FBQyxFQUNELE1BQU0sYUFBYTtBQUFBLE1BQ2xCLFNBQVM7QUFBQSxNQUNULFlBQVcsb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFBQSxJQUNwQyxFQUFFO0FBQUEsSUFFSixPQUFPLE1BQ0osU0FBUyx3QkFBd0IsRUFDakMsTUFBTSxFQUFFLEtBQUssQ0FBQyxFQUNkLE9BQU8sRUFBRSxPQUFPO0FBQUEsTUFDZixPQUFPLEVBQUUsT0FBTztBQUFBLE1BQ2hCLFNBQVMsRUFBRSxPQUFPO0FBQUEsTUFDbEIsUUFBUSxFQUFFLE9BQU87QUFBQSxJQUNuQixDQUFDLENBQUMsRUFDRCxNQUFNLGFBQWE7QUFBQSxNQUNsQixPQUFPO0FBQUEsTUFDUCxTQUFTO0FBQUEsTUFDVCxRQUFRO0FBQUEsSUFDVixFQUFFO0FBQUEsRUFDTixDQUFDO0FBQ0gsQ0FBQztBQUdELElBQ0csTUFBTSxVQUFVLElBQUksUUFBUSxPQUFPLEVBQUUsUUFBUSxNQUFNLENBQUMsRUFDcEQsTUFBTSxVQUFVLElBQUksUUFBUSxPQUFPLEVBQUUsUUFBUSxNQUFNLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==

//# sourceURL=file:///Users/lukereilly/hypequery/examples/vite-starter/api/queries.ts