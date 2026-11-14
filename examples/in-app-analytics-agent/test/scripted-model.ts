import { MockLanguageModelV4 } from 'ai/test';

type CallOptions = Parameters<MockLanguageModelV4['doStream']>[0];
type StreamPart = Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer T> ? T : never;

/**
 * A stand-in for the LLM: it makes exactly the tool calls you script, one per
 * step, then answers by repeating every tool result it was sent. So the test
 * sees what a real model would have seen, and what the user would be told.
 */
export interface ScriptedCall {
  toolName: string;
  input: Record<string, unknown>;
}

export interface ToolOutput {
  toolName: string;
  output: unknown;
}

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function stream(parts: StreamPart[]) {
  return {
    stream: new ReadableStream<StreamPart>({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
  };
}

/** Every tool result in a prompt, as the model receives it. */
export function toolOutputs(prompt: CallOptions['prompt']): ToolOutput[] {
  const outputs: ToolOutput[] = [];
  for (const message of prompt) {
    if (message.role !== 'tool') continue;
    for (const part of message.content) {
      if (part.type === 'tool-result') outputs.push({ toolName: part.toolName, output: (part.output as { value?: unknown }).value });
    }
  }
  return outputs;
}

export function scriptedModel(script: ScriptedCall[]): MockLanguageModelV4 {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async (options) => {
      const call = script[step];
      step += 1;
      if (call) {
        return stream([
          { type: 'stream-start', warnings: [] },
          { type: 'tool-call', toolCallId: `call_${step}`, toolName: call.toolName, input: JSON.stringify(call.input) },
          { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage },
        ]);
      }
      const answer = JSON.stringify(toolOutputs(options.prompt));
      return stream([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'answer' },
        { type: 'text-delta', id: 'answer', delta: answer },
        { type: 'text-end', id: 'answer' },
        { type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' }, usage },
      ]);
    },
  });
}
