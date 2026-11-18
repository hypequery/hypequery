import { collectSetupState, type CollectOptions } from '../utils/setup-state/collect.js';
import { doctorChecks, type DoctorCheck } from '../utils/setup-state/doctor-checks.js';
import { emitResult } from '../utils/machine-output.js';

const SYMBOL: Record<DoctorCheck['status'], string> = { ok: '✓', warn: '!', fail: '✗', skip: '-' };

/**
 * `hypequery doctor`: check Node, the CLI, the ClickHouse connection (and
 * whether its user is read-only), `.env` hygiene, the project's datasets and
 * Serve API, Cloud sign-in, every agent's hypequery MCP entry and the skills.
 * Each problem names its fix. Exit 1 when any check fails. Never prompts.
 */
export async function doctorCommand(dependencies: CollectOptions = {}): Promise<DoctorCheck[]> {
  const state = await collectSetupState({ probe: true, ...dependencies });
  const checks = doctorChecks(state);
  for (const check of checks) {
    console.log(`${SYMBOL[check.status]} ${check.message}`);
    if (check.fix && check.status !== 'ok') console.log(`    fix: ${check.fix}`);
  }
  const failed = checks.filter(check => check.status === 'fail').length;
  const warned = checks.filter(check => check.status === 'warn').length;
  console.log('');
  console.log(failed ? `${failed} problem${failed === 1 ? '' : 's'} to fix.` : warned ? 'No failures; see the warnings above.' : 'Everything looks good.');
  console.log('Run `hypequery next` for the next onboarding step.');
  emitResult({ ok: failed === 0, checks, state, next: 'hypequery next' });
  if (failed) process.exitCode = 1;
  return checks;
}
