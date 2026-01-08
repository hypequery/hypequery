import { createVercelEdgeHandler } from "@hypequery/serve";

import { api } from "../../../../lib/api";

export const runtime = "edge";

const handler = createVercelEdgeHandler(api.handler);

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
