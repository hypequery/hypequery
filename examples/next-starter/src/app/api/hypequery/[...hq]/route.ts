import { createVercelEdgeHandler } from '@hypequery/serve';
import { api } from '@/queries';

export const runtime = 'nodejs';

const baseHandler = createVercelEdgeHandler(api.handler);

const handler = async (
  request: Request,
  context: { params: Promise<{ hq: string[] }> }
) => {
  const params = await context.params;
  const path = `/${params.hq.join('/')}`;

  const url = new URL(request.url);
  url.pathname = path;

  const modifiedRequest = new Request(url, request);
  return baseHandler(modifiedRequest);
};

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
