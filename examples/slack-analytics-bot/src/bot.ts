import { createSlackBot, type SlackClient } from '@hypequery/slack';
import { answerQuestion } from '../lib/agent.js';
import { createTeamAccess, parseRoles } from '../lib/team.js';

export const SUGGESTED_PROMPTS = [
  { title: 'Usage', message: 'Events by type last month' },
  { title: 'Reliability', message: 'Error rate and p95 latency by device' },
  { title: 'Customers', message: 'Top 10 customers by active users' },
];

/** The bot, wired to your team's access rules. `main.ts` connects it to Slack. */
export function createBot(slack: SlackClient, env: NodeJS.ProcessEnv = process.env) {
  return createSlackBot({
    slack,
    resolveAccess: createTeamAccess({ members: parseRoles(env.SLACK_MEMBERS), channels: parseRoles(env.SLACK_CHANNELS) }),
    answer: answerQuestion,
    suggestedPrompts: SUGGESTED_PROMPTS,
  });
}
