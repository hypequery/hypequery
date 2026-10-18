import { MCPToolError } from '../../errors.js';

/** Read only own data properties. Nested query values go through the shared bounded validator. */
export function httpToolArguments(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  try {
    const value = input === undefined ? {} : input;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error();
    const keys = Reflect.ownKeys(value);
    if (keys.length > allowed.length || keys.some(key => typeof key !== 'string' || !allowed.includes(key))) throw new Error();
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error();
      result[key] = descriptor.value;
    }
    return result;
  } catch { throw new MCPToolError('MCP_INVALID_ARGUMENTS', 'Invalid client tool arguments.'); }
}
