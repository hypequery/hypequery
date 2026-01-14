import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

import { api } from './api';

type MetricKey = keyof typeof api.queries;
const availableMetrics = Object.keys(api.queries) as MetricKey[];

const hypequeryToolParams = z.object({
  metric: z.string().describe('Exact query key, e.g. weeklyRevenue or regionalBreakdown'),
  params: z
    .record(z.unknown())
    .optional()
    .describe("Object matching the metric's input schema (omit if none)."),
});

const hypequeryTool = tool({
  description:
    'Execute any hypequery metric by key. Inspect api.describe() to decide which query + params to send.',
  parameters: hypequeryToolParams,
  execute: async ({ metric, params }: z.infer<typeof hypequeryToolParams>) => {
    if (!availableMetrics.includes(metric as MetricKey)) {
      throw new Error(`Unknown metric: ${metric}. Known metrics: ${availableMetrics.join(', ')}`);
    }

    const key = metric as MetricKey;
    return params ? api.execute(key, { input: params }) : api.execute(key);
  },
});

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Set OPENAI_API_KEY to run the AI SDK demo.');
  }

  const response = await generateText({
    model: openai('gpt-4o-mini'),
    tools: { hypequery: hypequeryTool },
    messages: [
      {
        role: 'user',
        content:
          'Summarize the latest enterprise revenue and mention any regional callouts. Cite metrics you run.',
      },
    ],
  });

  console.log('Model response:\n');
  console.log(response.text);
  console.log('\nTool calls:\n');
  console.log(response.toolCalls);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
