import type {
  ProtocolQueryEventLimits,
  ProtocolQueryEventOptions,
} from './types.js';

export const DEFAULT_PROTOCOL_QUERY_EVENT_LIMITS:
Readonly<ProtocolQueryEventLimits> = Object.freeze({
  maxStringBytes: 1_024,
  maxDebugBytes: 4_096,
});

export function resolveQueryEventLimits(
  options: ProtocolQueryEventOptions = {},
): Readonly<ProtocolQueryEventLimits> {
  const result = { ...DEFAULT_PROTOCOL_QUERY_EVENT_LIMITS };
  for (const key of Object.keys(result) as (keyof ProtocolQueryEventLimits)[]) {
    const value = options.limits?.[key];
    if (value === undefined) continue;
    const maximum = DEFAULT_PROTOCOL_QUERY_EVENT_LIMITS[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new RangeError(
        `${key} must be a positive safe integer no greater than ${maximum} `
        + '(the query event v1 maximum)',
      );
    }
    result[key] = value;
  }
  return Object.freeze(result);
}
