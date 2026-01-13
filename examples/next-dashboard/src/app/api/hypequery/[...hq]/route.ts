import { createVercelEdgeHandler } from '@hypequery/serve';

import { api } from '@/analytics/api';

export const runtime = 'nodejs';

const handler = createVercelEdgeHandler(api.handler);

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
