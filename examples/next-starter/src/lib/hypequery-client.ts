import { api } from "@/queries";
import { createHooks } from "@hypequery/react";
import { InferApiType } from "@hypequery/serve";

// Automatic type inference - no manual type definition needed!
type StarterApi = InferApiType<typeof api>;

export const {
  useQuery,
} = createHooks<StarterApi>({
  baseUrl: '/api/hypequery',
});