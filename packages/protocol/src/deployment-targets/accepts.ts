/**
 * A deployment target's capability advertisement (RFC 0030): the deployment
 * contract, semantic invocation and bundle manifest versions it accepts.
 */

import { deploymentError } from '../deployments/errors.js';

export interface ProtocolDeploymentTargetAccepts {
  /** Deployment contract versions the target stores, activates and serves. */
  readonly deploymentContract: readonly number[];
  /** Semantic invocation versions its data plane runs, against every accepted contract. */
  readonly semanticInvocation: readonly number[];
  /** Deployment bundle manifest versions its intake accepts. */
  readonly bundle: readonly number[];
}

/**
 * What a target that advertises nothing accepts: the versions every hypequery
 * Cloud release has served. Each absent member takes its default on its own.
 */
export const DEFAULT_PROTOCOL_DEPLOYMENT_TARGET_ACCEPTS: ProtocolDeploymentTargetAccepts = Object.freeze({
  deploymentContract: Object.freeze([2]),
  semanticInvocation: Object.freeze([1]),
  bundle: Object.freeze([1, 2]),
});

const MEMBERS = ['deploymentContract', 'semanticInvocation', 'bundle'] as const;
/** Far above any version this protocol will define; bounds hostile input. */
const MAX_VERSIONS = 64;

function versions(input: unknown, path: string): readonly number[] {
  if (!Array.isArray(input)) deploymentError('HQ_DEPLOYMENT_TYPE', path);
  if (input.length === 0 || input.length > MAX_VERSIONS) deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', path);
  const result: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, index);
    if (descriptor === undefined || !('value' in descriptor)) deploymentError('HQ_DEPLOYMENT_UNSAFE_OBJECT', `${path}[${index}]`);
    const value: unknown = descriptor.value;
    if (typeof value !== 'number') deploymentError('HQ_DEPLOYMENT_TYPE', `${path}[${index}]`);
    if (!Number.isSafeInteger(value) || value < 1) deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}[${index}]`);
    // Ascending and distinct, so one advertisement has one encoding.
    if (index > 0 && value <= result[index - 1]!) deploymentError('HQ_DEPLOYMENT_INVALID_VALUE', `${path}[${index}]`);
    result.push(value);
  }
  return Object.freeze(result);
}

/**
 * Validate a target's `accepts` advertisement and fill each absent member with
 * its default. `undefined` (no advertisement) is the default advertisement.
 * Unknown members are ignored, so a later RFC can add one. Every present
 * member must be a non-empty, ascending list of distinct positive safe
 * integers; anything else throws `ProtocolDeploymentError` at its path.
 */
export function validateProtocolDeploymentTargetAccepts(input: unknown): ProtocolDeploymentTargetAccepts {
  if (input === undefined) return DEFAULT_PROTOCOL_DEPLOYMENT_TARGET_ACCEPTS;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) deploymentError('HQ_DEPLOYMENT_TYPE', '$');
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) deploymentError('HQ_DEPLOYMENT_UNSAFE_OBJECT', '$');
  const result: Record<string, readonly number[]> = {};
  for (const member of MEMBERS) {
    const descriptor = Object.getOwnPropertyDescriptor(input, member);
    if (descriptor === undefined) {
      result[member] = DEFAULT_PROTOCOL_DEPLOYMENT_TARGET_ACCEPTS[member];
      continue;
    }
    if (!('value' in descriptor)) deploymentError('HQ_DEPLOYMENT_UNSAFE_OBJECT', `$.${member}`);
    result[member] = versions(descriptor.value, `$.${member}`);
  }
  return Object.freeze(result) as unknown as ProtocolDeploymentTargetAccepts;
}
