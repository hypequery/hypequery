import { api } from "@/queries";
import { createHooks } from "@hypequery/react";
import type { InferApiType } from "@hypequery/serve";

type StarterApi = InferApiType<typeof api>;

export const { useQuery } = createHooks<StarterApi>({
  baseUrl: '/api/hypequery',
  api, // Auto-extracts HTTP methods from route configuration
});