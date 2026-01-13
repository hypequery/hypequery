import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

import { api } from './api';

const hypequeryTool = tool({
  description: 'Call typed hypequery metrics (weeklyRevenue, regionalBreakdown, growthNotes).',
  parameters: z.object({
    metric: z.enum(['weeklyRevenue', 'regionalBreakdown', 'growthNotes']),
    plan: z.string().optional().describe('Only used for weeklyRevenue'),
  }),
  execute: async ({ metric, plan }) => {
    if (metric === 'weeklyRevenue') {
      return api.run('weeklyRevenue', { plan });
    }
    return api.run(metric as 'regionalBreakdown' | 'growthNotes');
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
