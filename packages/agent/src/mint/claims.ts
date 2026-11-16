import { AgentTokenError } from './errors.js';

/**
 * The claim rules Cloud applies to a managed-key token (AG-18a, the same as
 * for a customer JWT). A mint that breaks one throws instead of producing a
 * token the tenant endpoint refuses. `python/hypequery/src/hypequery/agent`
 * applies the same rules, pinned by `specs/agent-token/fixtures/mint-v1`.
 */

/** The longest lifetime (`exp` − `iat`) Cloud accepts: 15 minutes. */
export const AGENT_TOKEN_MAX_LIFETIME_SECONDS = 15 * 60;
export const MAX_AGENT_CONSTRAINTS = 8;
export const MAX_AGENT_CONSTRAINT_VALUES = 100;

/** A protocol target token: the project's protocol name, at most 128 bytes. */
const PROJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SUBJECT_PATTERN = /^[\x21-\x7e]{1,128}$/;
const TENANT_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const PERMISSION_SET_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const FILTER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export type AgentConstraintScalar = string | number | boolean;

/**
 * A filter every query the end user makes carries. It names one of the
 * dataset's declared filters; a dataset without it refuses the query rather
 * than skip the constraint.
 */
export type AgentConstraint =
  | { readonly filter: string; readonly operator: 'eq'; readonly value: AgentConstraintScalar }
  | {
      readonly filter: string;
      readonly operator: 'in';
      readonly value: readonly AgentConstraintScalar[];
    };

export function checkProject(value: unknown): string {
  if (typeof value !== 'string' || !PROJECT_PATTERN.test(value)) {
    throw new AgentTokenError(
      'project',
      'project must be the project\'s protocol name as Cloud shows it (for example "acme:logistics").',
    );
  }
  return value;
}

export function checkSubject(value: unknown): string {
  if (typeof value !== 'string' || !SUBJECT_PATTERN.test(value)) {
    throw new AgentTokenError(
      'subject',
      'subject must be 1 to 128 printable ASCII characters, without spaces.',
    );
  }
  return value;
}

export function checkTenant(value: unknown): string {
  if (typeof value !== 'string' || !TENANT_PATTERN.test(value)) {
    throw new AgentTokenError(
      'tenant',
      'tenant must be 1 to 128 characters of letters, digits, ".", "_", ":" or "-".',
    );
  }
  return value;
}

export function checkPermissionSet(value: unknown): string {
  if (typeof value !== 'string' || !PERMISSION_SET_PATTERN.test(value)) {
    throw new AgentTokenError(
      'permissionSet',
      'permissionSet must name one of the project\'s permission sets (lowercase letters, digits and "-").',
    );
  }
  return value;
}

export function checkLifetime(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > AGENT_TOKEN_MAX_LIFETIME_SECONDS
  ) {
    throw new AgentTokenError(
      'expiresInSeconds',
      `expiresInSeconds must be a whole number of seconds from 1 to ${AGENT_TOKEN_MAX_LIFETIME_SECONDS}.`,
    );
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function scalar(value: unknown, where: string): AgentConstraintScalar {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value)) return value;
    throw new AgentTokenError('constraints', `${where} must be a safe integer, a string or a boolean.`);
  }
  if (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 256 &&
    !LONE_SURROGATE.test(value)
  ) {
    return value;
  }
  throw new AgentTokenError(
    'constraints',
    `${where} must be a string of 1 to 256 characters, a safe integer or a boolean.`,
  );
}

/**
 * Copies the constraints into the claim's exact shape (`filter`, `operator`,
 * `value`, in that order), refusing anything Cloud would refuse: a token
 * whose constraints don't parse is refused outright.
 */
export function checkConstraints(value: unknown): AgentConstraint[] {
  if (!Array.isArray(value)) {
    throw new AgentTokenError('constraints', 'constraints must be an array.');
  }
  if (value.length > MAX_AGENT_CONSTRAINTS) {
    throw new AgentTokenError(
      'constraints',
      `A token can carry at most ${MAX_AGENT_CONSTRAINTS} constraints.`,
    );
  }
  const filters = new Set<string>();
  // Array.from visits holes too, so a sparse array is refused, not serialized as null.
  return Array.from(value, (entry: unknown, index) => {
    const where = `constraints[${index}]`;
    if (!isPlainObject(entry)) {
      throw new AgentTokenError('constraints', `${where} must be an object.`);
    }
    for (const key of Object.keys(entry)) {
      if (key !== 'filter' && key !== 'operator' && key !== 'value') {
        throw new AgentTokenError('constraints', `${where} has an unknown member "${key}".`);
      }
    }
    const { filter, operator } = entry;
    if (typeof filter !== 'string' || !FILTER_PATTERN.test(filter)) {
      throw new AgentTokenError('constraints', `${where}.filter must name a dataset filter.`);
    }
    if (filters.has(filter)) {
      throw new AgentTokenError('constraints', `Each filter may be constrained once ("${filter}").`);
    }
    filters.add(filter);
    if (operator === 'eq') {
      return { filter, operator, value: scalar(entry.value, `${where}.value`) };
    }
    if (operator === 'in') {
      const values = entry.value;
      if (
        !Array.isArray(values) ||
        values.length < 1 ||
        values.length > MAX_AGENT_CONSTRAINT_VALUES
      ) {
        throw new AgentTokenError(
          'constraints',
          `${where}.value must be a list of 1 to ${MAX_AGENT_CONSTRAINT_VALUES} values.`,
        );
      }
      return {
        filter,
        operator,
        value: Array.from(values, (item: unknown, position) =>
          scalar(item, `${where}.value[${position}]`),
        ),
      };
    }
    throw new AgentTokenError('constraints', `${where}.operator must be "eq" or "in".`);
  });
}
