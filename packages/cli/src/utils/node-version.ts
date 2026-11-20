/** The oldest Node the CLI runs on; its dependencies (commander 15, chalk 6, ora 10) need 22.12. Keep in sync with `engines`. */
export const MINIMUM_NODE_VERSION = '22.12.0';

function parts(version: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version.replace(/^v/, '').split('.').map(part => Number.parseInt(part, 10) || 0);
  return [major, minor, patch];
}

/** Whether `version` (such as `process.version`) is at least `minimum`. */
export function isSupportedNode(version: string = process.version, minimum = MINIMUM_NODE_VERSION): boolean {
  const have = parts(version);
  const need = parts(minimum);
  for (let index = 0; index < 3; index += 1) {
    if (have[index] !== need[index]) return have[index] > need[index];
  }
  return true;
}

/** What to tell someone on an older Node, naming the fix. */
export function unsupportedNodeMessage(version: string = process.version): string {
  return `hypequery needs Node ${MINIMUM_NODE_VERSION} or newer, but this is Node ${version.replace(/^v/, '')}. `
    + 'Upgrade Node (for example `nvm install 24`), then run the command again.';
}
