import { CliError } from './cli-error.js';

const MAX_CAPABILITIES = 32;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9_-]*(?::[a-z0-9_-]+)*$/;

/**
 * `--capabilities workspace:view,deployment:publish` (commas or spaces).
 * Only the shape is checked here; Cloud knows which capabilities exist and
 * refuses any the approving member doesn't hold.
 */
export function parseCapabilityList(input: string): string[] {
  const values = [...new Set(input.split(/[\s,]+/).filter(value => value.length > 0))];
  if (values.length === 0 || values.length > MAX_CAPABILITIES
    || values.some(value => value.length > 64 || !CAPABILITY_PATTERN.test(value))) {
    throw new CliError('INVALID_INPUT',
      `Invalid --capabilities: pass up to ${MAX_CAPABILITIES} capability names separated by commas, `
      + 'for example workspace:view,deployment:publish.', {
        hint: 'Pass --capabilities workspace:view,deployment:publish, or omit it for your role\'s own capabilities.',
      });
  }
  return values;
}
