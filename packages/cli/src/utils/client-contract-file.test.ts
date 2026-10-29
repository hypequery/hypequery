import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkClientOutputPath } from './client-contract-file.js';

const temporary: string[] = [];
async function directory() {
  const created = await realpath(await mkdtemp(path.join(tmpdir(), 'hq-output-')));
  temporary.push(created);
  return created;
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(entry => rm(entry, { recursive: true, force: true })));
});

describe('checkClientOutputPath', () => {
  it('accepts a new or existing regular file under ordinary directories', async () => {
    const root = await directory();
    await expect(checkClientOutputPath(path.join(root, 'new', 'client.ts'))).resolves.toBeUndefined();
    await writeFile(path.join(root, 'client.ts'), '');
    await expect(checkClientOutputPath(path.join(root, 'client.ts'))).resolves.toBeUndefined();
  });

  it('names a symlinked ancestor and the same output without it', async () => {
    const root = await directory();
    await mkdir(path.join(root, 'real'));
    await symlink(path.join(root, 'real'), path.join(root, 'link'));
    const output = path.join(root, 'link', 'out', 'client.ts');
    const refusal = checkClientOutputPath(output);
    await expect(refusal).rejects.toThrow(`Client output ${output} must be a regular file under ordinary directories: ${path.join(root, 'link')} is a symbolic link.`);
    await expect(checkClientOutputPath(output)).rejects.toThrow(`Use the path it points to instead: ${path.join(root, 'real', 'out', 'client.ts')}`);
  });

  it('names a symlinked output file', async () => {
    const root = await directory();
    await writeFile(path.join(root, 'real.ts'), '');
    await symlink(path.join(root, 'real.ts'), path.join(root, 'client.ts'));
    await expect(checkClientOutputPath(path.join(root, 'client.ts'))).rejects.toThrow('must be a regular file, not a symbolic link.');
  });

  it('suggests the file a symlinked output points to', async () => {
    const root = await directory();
    await writeFile(path.join(root, 'real.ts'), '');
    await symlink(path.join(root, 'real.ts'), path.join(root, 'client.ts'));
    await expect(checkClientOutputPath(path.join(root, 'client.ts'))).rejects.toThrow(`Use the path it points to instead: ${path.join(root, 'real.ts')}`);
  });

  it('suggests nothing when a link points to the wrong kind of entry', async () => {
    const root = await directory();
    await writeFile(path.join(root, 'real.txt'), '');
    await symlink(path.join(root, 'real.txt'), path.join(root, 'to-file'));
    await mkdir(path.join(root, 'folder'));
    await symlink(path.join(root, 'folder'), path.join(root, 'client.ts'));
    const belowFile = checkClientOutputPath(path.join(root, 'to-file', 'client.ts'));
    await expect(belowFile).rejects.toThrow(`${path.join(root, 'to-file')} is a symbolic link.`);
    await expect(checkClientOutputPath(path.join(root, 'to-file', 'client.ts'))).rejects.not.toThrow('Use the path');
    await expect(checkClientOutputPath(path.join(root, 'client.ts'))).rejects.toThrow('must be a regular file, not a symbolic link.');
    await expect(checkClientOutputPath(path.join(root, 'client.ts'))).rejects.not.toThrow('Use the path');
  });

  it('names a dangling symlink without suggesting a path', async () => {
    const root = await directory();
    await symlink(path.join(root, 'missing'), path.join(root, 'link'));
    const output = path.join(root, 'link', 'client.ts');
    await expect(checkClientOutputPath(output)).rejects.toThrow(new RegExp(`${path.join(root, 'link').replaceAll('/', '\\/')} is a symbolic link\\.$`));
  });

  it('names an ancestor that is not a directory, and an output that is not a file', async () => {
    const root = await directory();
    await writeFile(path.join(root, 'file'), '');
    await expect(checkClientOutputPath(path.join(root, 'file', 'client.ts'))).rejects.toThrow(`${path.join(root, 'file')} is not a directory.`);
    await mkdir(path.join(root, 'folder.ts'));
    await expect(checkClientOutputPath(path.join(root, 'folder.ts'))).rejects.toThrow(`Client output ${path.join(root, 'folder.ts')} must be a regular file.`);
  });
});
