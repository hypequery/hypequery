import type { SlackClient } from '@hypequery/slack';

/** Records every Slack Web API call the bot makes instead of sending it. */
export function fakeSlack() {
  const calls: Array<{ method: string; args: any }> = [];
  const record = (method: string) => async (args: any) => {
    calls.push({ method, args });
    return { ok: true as const, ts: '99.0', channel: args.channel ?? args.channel_id, message_ts: '99.0' };
  };
  const slack: SlackClient = {
    call: async (method: string, args: any) => {
      calls.push({ method, args });
      return { ok: true as const, channel: { id: 'DPRIVATE' } } as any;
    },
    postMessage: record('chat.postMessage') as any,
    postEphemeral: record('chat.postEphemeral') as any,
    updateMessage: record('chat.update') as any,
    setAssistantStatus: record('assistant.threads.setStatus') as any,
    setSuggestedPrompts: record('assistant.threads.setSuggestedPrompts') as any,
    setThreadTitle: record('assistant.threads.setTitle') as any,
    threadReplies: async () => [],
  };
  const posts = () => calls.filter(c => c.method === 'chat.postMessage' || c.method === 'chat.postEphemeral');
  return { slack, calls, posts };
}
