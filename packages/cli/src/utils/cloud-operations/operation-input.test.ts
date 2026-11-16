import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CLOUD_OPERATION_SPECS } from '../../generated/cloud-operations.js';
import { commandShape } from './command-shape.js';
import { buildOperationInput } from './operation-input.js';

const shape = commandShape(CLOUD_OPERATION_SPECS.find(operation => operation.name === 'members.invite')!);
const cwd = path.resolve('/work/project');

function context(warn = vi.fn()) {
  const readTextFile = vi.fn(async () => '{"email":"ada@example.com","role":"member"}');
  return { readTextFile, warn, cwd, readStdin: async () => '' };
}

describe('--input-json @<file>', () => {
  it('reads a file inside the working directory without a notice', async () => {
    const files = context();
    await expect(buildOperationInput(shape, [], { inputJson: '@input/invite.json' }, files))
      .resolves.toEqual({ email: 'ada@example.com', role: 'member' });
    expect(files.readTextFile).toHaveBeenCalledWith(path.join(cwd, 'input', 'invite.json'));
    expect(files.warn).not.toHaveBeenCalled();
  });

  it('refuses a relative path that climbs out of the working directory, before reading it', async () => {
    const files = context();
    await expect(buildOperationInput(shape, [], { inputJson: '@../../home/me/.config/x.json' }, files))
      .rejects.toMatchObject({ code: 'INVALID_OPTION', issues: [{ path: '--input-json' }] });
    expect(files.readTextFile).not.toHaveBeenCalled();
  });

  it('reads an absolute path outside the working directory, and names it on stderr', async () => {
    const files = context();
    const outside = path.resolve('/elsewhere/invite.json');
    await buildOperationInput(shape, [], { inputJson: `@${outside}` }, files);
    expect(files.readTextFile).toHaveBeenCalledWith(outside);
    expect(files.warn).toHaveBeenCalledWith(expect.stringContaining(outside));
  });
});
