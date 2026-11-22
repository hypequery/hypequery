/**
 * Deepest object/array nesting a tool call may use. A filter group costs two
 * levels (the group and its list), so this comfortably holds the dataset
 * client's 32 group levels while stopping a hostile tree long before a
 * schema that refers to itself could exhaust the stack.
 */
export const MAX_ARGUMENT_DEPTH = 96;

/** Most values one walk visits, so an object graph that shares nodes cannot make it explode. */
const MAX_VISITS = 100_000;

/**
 * Whether `value` nests objects or arrays deeper than `maximum`, or is too
 * large to walk. Iterative, so the check itself never recurses; a cycle reads
 * as infinitely deep.
 */
export function argumentsTooDeep(value: unknown, maximum = MAX_ARGUMENT_DEPTH): boolean {
  const pending: Array<[unknown, number]> = [[value, 0]];
  let visits = 0;
  while (pending.length > 0) {
    const [item, depth] = pending.pop()!;
    if (typeof item !== 'object' || item === null) continue;
    if (depth >= maximum || ++visits > MAX_VISITS) return true;
    for (const child of Array.isArray(item) ? item : Object.values(item)) pending.push([child, depth + 1]);
  }
  return false;
}
