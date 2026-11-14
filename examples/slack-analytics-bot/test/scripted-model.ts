import { MockLanguageModelV4 } from 'ai/test';

/**
 * A stand-in for the LLM: it makes exactly the tool calls you script, one per
 * step, then answers with a fixed sentence. The tests then check what reached
 * Slack, so they cover what a real model's tool calls would produce.
 */
export interface ScriptedCall {
  toolName: string;
  input: Record<string, unknown>;
}

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

export function scriptedModel(script: ScriptedCall[], answer = 'Here is what I found.'): MockLanguageModelV4 {
  let step = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const call = script[step];
      step += 1;
      if (call) {
        return {
          content: [{ type: 'tool-call', toolCallId: `call_${step}`, toolName: call.toolName, input: JSON.stringify(call.input) }],
          finishReason: { unified: 'tool-calls', raw: 'tool_use' },
          usage,
          warnings: [],
        };
      }
      return { content: [{ type: 'text', text: answer }], finishReason: { unified: 'stop', raw: 'end_turn' }, usage, warnings: [] };
    },
  });
}
