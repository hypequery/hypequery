import type { ApiDefinition } from "@/queries";
import { createHooks } from "@hypequery/react";

export const { useQuery } = createHooks<ApiDefinition>({
  baseUrl: '/api/hypequery',
});
