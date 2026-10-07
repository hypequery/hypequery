import { describe, expect, it, vi } from 'vitest';
import type { MCPToolExecutor } from '@hypequery/mcp';
import { CommandLifecycle } from './lifecycle.js';
import { TelemetryInvocation } from './invocation.js';
import { withCommandTelemetry, startCommandSession } from './command-context.js';
import { McpSession } from './mcp-session.js';
import { DevSession } from './dev-session.js';
import { devSessionConfig } from './session-config.js';
import { CommandExit } from '../command-exit.js';
import { common } from '../../../type-tests/fixtures.js';
import { validateTelemetryEvent } from './validation.js';

describe('aggregate CLI session telemetry', () => {
  it('emits one start/end pair across dev reloads, with errors reduced to stable codes', async () => {
    const record = vi.fn();
    const spy = vi.spyOn(TelemetryInvocation, 'create').mockResolvedValue({ common, record, flush: vi.fn() } as unknown as TelemetryInvocation);
    try {
      const lifecycle = new CommandLifecycle(['dev']);
      await lifecycle.begin('dev');
      await withCommandTelemetry(lifecycle, async () => {
        const session = new DevSession();
        session.loadFailed(new Error('PRIVATE_INITIAL_PATH'));
        session.start('/PRIVATE_PATH/api.ts', undefined, { watch: true, redisUrl: 'PRIVATE_CREDENTIALS', cache: 'redis' });
        session.reload(); session.reloadFailed();
        session.loadFailed(Object.assign(new Error('PRIVATE_SQL'), { code: 'compile_error' }));
        session.reload(); session.start('/PRIVATE_RELOAD/queries.ts', undefined, {});
      });
      lifecycle.markInterrupted();
      await lifecycle.finish(new CommandExit(0, 'success'));
      await lifecycle.finish(new CommandExit(0, 'success'));
      const events = record.mock.calls.map(([event]) => event);
      expect(events.map(event => event.event)).toEqual(['cli_session_started', 'cli_session_ended', 'cli_command_completed']);
      expect(events[1].properties).toMatchObject({ outcome: 'interrupted', reload_count_bucket: '2-5', reload_error_count_bucket: '1', load_failures: { load_error: '1', compile_error: '1' } });
      expect(events.every(validateTelemetryEvent)).toBe(true);
      expect(JSON.stringify(events)).not.toContain('PRIVATE');
    } finally { spy.mockRestore(); }
  });

  it('ignores failures in optional end counters and still completes the command', async () => {
    const record = vi.fn();
    const spy = vi.spyOn(TelemetryInvocation, 'create').mockResolvedValue({ common, record, flush: vi.fn() } as unknown as TelemetryInvocation);
    try {
      const lifecycle = new CommandLifecycle(['dev']);
      await lifecycle.begin('dev');
      withCommandTelemetry(lifecycle, () => startCommandSession('dev', devSessionConfig('api.ts', undefined, {}), () => { throw new Error('PRIVATE'); }));
      await lifecycle.finish(new CommandExit(1, 'failure', 'unknown'));
      expect(record.mock.calls.map(([event]) => event.event)).toEqual(['cli_session_started', 'cli_command_completed']);
    } finally { spy.mockRestore(); }
  });

  it('wraps the real executor interface without retaining names or arguments or changing results', async () => {
    const result = { content: [] };
    const call = vi.fn().mockResolvedValue(result);
    const executor: MCPToolExecutor = { callTool: call, listTools: vi.fn(), listPrompts: vi.fn(), getPrompt: vi.fn(), getManifestHash: () => 'hash' };
    const session = new McpSession();
    const wrapped = session.instrument(executor);
    const signal = new AbortController().signal;
    expect(await wrapped.callTool('list_datasets', { PRIVATE_NAME: 'PRIVATE_ARGUMENT' }, signal)).toBe(result);
    expect(call).toHaveBeenCalledWith('list_datasets', { PRIVATE_NAME: 'PRIVATE_ARGUMENT' }, signal);
    await wrapped.callTool('get_dataset_schema', { dataset: 'PRIVATE_DATASET' });
    await wrapped.callTool('query_metric', {});
    call.mockResolvedValueOnce({ content: [], isError: true });
    await wrapped.callTool('query_dataset', {});
    const error = new Error('PRIVATE_ERROR');
    call.mockRejectedValueOnce(error);
    await expect(wrapped.callTool('PRIVATE_UNKNOWN_TOOL')).rejects.toBe(error);
    expect(session.snapshot()).toEqual({ tool_call_counts: { list: '1', describe: '1', query: '2-5' }, error_count_bucket: '2-5' });
    expect(JSON.stringify(session.snapshot())).not.toContain('PRIVATE');
    expect(wrapped.getManifestHash()).toBe('hash');
  });

  it('classifies startup choices without copying arbitrary flag values', () => {
    expect(devSessionConfig('/PRIVATE/api.ts', 'PRIVATE_FILE', { cache: 'PRIVATE_CACHE', hostname: 'PRIVATE_HOST', port: 12345 })).toMatchObject({ entry_type: 'explicit_file', cache_provider: 'unknown', custom_port: true });
    expect(devSessionConfig('/PRIVATE/queries.ts', undefined, { port: 4000 })).toMatchObject({ entry_type: 'queries.ts', custom_port: false });
    expect(devSessionConfig('/PRIVATE/hypequery.ts', undefined, {})).toMatchObject({ entry_type: 'hypequery.ts' });
    expect(devSessionConfig('/PRIVATE/other.ts', undefined, {})).toMatchObject({ entry_type: 'unknown' });
  });
});
