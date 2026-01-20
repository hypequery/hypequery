import { createVercelEdgeHandler } from '@hypequery/serve';

import { api } from '@/analytics/queries';

export const runtime = 'nodejs';

const baseHandler = createVercelEdgeHandler(api.handler);

// Wrapper to extract the catch-all route params and construct the path
const handler = async (request: Request, context: { params: Promise<{ hq: string[] }> }) => {
  // Get the catch-all params
  const params = await context.params;
  const path = `/${params.hq.join('/')}`;

  // Create a new request with the modified path
  const url = new URL(request.url);
  url.pathname = path;

  const modifiedRequest = new Request(url, request);
  return baseHandler(modifiedRequest);
};

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
