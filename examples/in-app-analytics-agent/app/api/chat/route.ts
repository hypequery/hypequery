import { convertToModelMessages, isStepCount, streamText, type UIMessage } from 'ai';
import { chatModel } from '@/lib/model';
import { agentTools } from '@/lib/agent-tools';
import { getSession } from '@/lib/session';

export const maxDuration = 60;

const INSTRUCTIONS = `You are the analytics assistant inside our product.
Answer questions about the signed-in customer's own product usage with the hypequery tools:
list_datasets (it includes the business context: KPI definitions, glossary, conventions and
caveats), then get_dataset_schema, then query_dataset. Use the KPI definitions and conventions
when you choose measures and present results. Quote numbers exactly as the tools return them.
You can only ever see the signed-in customer's data; if asked about another customer, say you
can't share it.`;

export async function POST(request: Request) {
  // Who is asking comes from your server-side session. The tenant is never
  // read from the request body, a header the browser sets, or the model.
  const session = getSession(request);
  if (!session) return Response.json({ error: 'Sign in first.' }, { status: 401 });

  // Cloud: an end-user token for this session, signed locally. Self-hosted:
  // the same tools in this process, bound to this session's tenant.
  const tools = await agentTools(session);

  const { messages } = (await request.json()) as { messages: UIMessage[] };
  const result = streamText({
    model: chatModel(),
    instructions: INSTRUCTIONS,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: isStepCount(8),
  });
  return result.toUIMessageStreamResponse();
}
