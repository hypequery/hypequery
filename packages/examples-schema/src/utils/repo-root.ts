import fs from 'node:fs';
import path from 'node:path';

/** Walk up from `start` to the folder holding `pnpm-workspace.yaml`. */
export function findRepoRoot(start: string): string {
  let current = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Could not find pnpm-workspace.yaml above ${start}`);
    }
    current = parent;
  }
}
