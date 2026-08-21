// The TypeScript reference adapter. Maps each family/role/case to the public
// root export of @hypequery/protocol and returns a wire result. Every operation
// goes through the package's supported surface — this is exactly what a second
// implementation must reproduce.
import {
  decodeCanonicalValue,
  deriveProtocolCacheKey,
  deriveProtocolCacheNamespaceToken,
  encodeCanonicalValue,
  hashCanonicalValue,
  parseProtocolIdentifier,
  parseProtocolQualifiedIdentifier,
  prepareProtocolDeploymentBundleManifest,
  prepareProtocolDeploymentContract,
  prepareProtocolDeploymentReleaseEnvelope,
  splitProtocolQualifiedIdentifier,
  validateCanonicalValue,
  validateProtocolDeploymentBundleManifest,
  validateProtocolDeploymentContract,
  validateProtocolDeploymentReleaseEnvelope,
  validateProtocolExpression,
  validateProtocolQueryDiagnostics,
  validateProtocolQueryEvent,
  validateProtocolQueryImplementation,
  validateProtocolSchema,
  validateProtocolSemanticQuery,
  validateProtocolSqlExpression,
} from '@hypequery/protocol';
import type { FixtureRole, HandlerResult } from '../types.js';
import {
  materializeBundle,
  materializeDeployment,
  materializeDiagnostics,
  materializeEvent,
  materializeExpression,
  materializeIdentifier,
  materializeImplementation,
  materializeRelease,
  materializeSchema,
  materializeTaggedValue,
} from './generators.js';

type Case = Record<string, unknown>;

const STABLE_CODE = /^HQ_[A-Z0-9_]+$/;

/** Turns a thrown protocol error into a wire rejection; rethrows anything else. */
function mapError(error: unknown): HandlerResult {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string' && STABLE_CODE.test(code)) return { ok: false, code };
  throw error;
}

function attempt(fn: () => HandlerResult): HandlerResult {
  try {
    return fn();
  } catch (error) {
    return mapError(error);
  }
}

const ACCEPT: HandlerResult = { ok: true };

/** The input a validation case feeds to its validator. */
function validationInput(c: Case, materialize: (spec: Record<string, unknown>) => unknown): unknown {
  return c.generator ? materialize(c.generator as Record<string, unknown>) : c.value;
}

/**
 * RFC 0012 hostile-object suite declaration for the TypeScript reference
 * implementation. The cases live in @hypequery/protocol's
 * `src/values/codec.test.ts`; each mechanism listed here is exercised there.
 */
export const REFERENCE_HOSTILE_OBJECT_SUITE = {
  count: 7,
  mechanisms: [
    'getter',
    'toJSON',
    'proxy',
    'custom-prototype',
    'symbol-key',
    'sparse-array',
    'cycle',
  ],
} as const;

export const REFERENCE_FAMILIES = [
  'cache-keys-v1',
  'tagged-values-v1',
  'identifiers-v1',
  'expressions-v1',
  'query-schemas-v1',
  'query-implementations-v1',
  'query-events-v1',
  'query-diagnostics-v1',
  'deployments-v1',
  'deployment-bundles-v1',
  'deployment-releases-v1',
] as const;

export function referenceHandle(
  family: string,
  role: FixtureRole,
  c: Case,
  section?: string,
): HandlerResult {
  switch (family) {
    case 'tagged-values-v1':
      return handleTaggedValue(role, c);
    case 'identifiers-v1':
      return handleIdentifier(role, c);
    case 'expressions-v1':
      return handleExpression(role, c, section);
    case 'query-schemas-v1':
      return attempt(() => {
        validateProtocolSchema(validationInput(c, materializeSchema));
        return ACCEPT;
      });
    case 'query-implementations-v1':
      return handleImplementation(c);
    case 'query-events-v1':
      return attempt(() => {
        validateProtocolQueryEvent(validationInput(c, materializeEvent));
        return ACCEPT;
      });
    case 'query-diagnostics-v1':
      return attempt(() => {
        validateProtocolQueryDiagnostics(validationInput(c, materializeDiagnostics));
        return ACCEPT;
      });
    case 'deployments-v1':
      return handleDeployment(role, c);
    case 'deployment-bundles-v1':
      return handleBundle(role, c);
    case 'deployment-releases-v1':
      return handleRelease(role, c);
    case 'cache-keys-v1':
      return handleCacheKey(role, c);
    default:
      throw new Error(`reference adapter does not support family ${family}`);
  }
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

function handleCacheKey(role: FixtureRole, c: Case): HandlerResult {
  const generator = c.generator as { type?: string; utf8?: string; count?: number } | undefined;
  const preimage =
    generator?.type === 'repeat-string'
      ? (generator.utf8 ?? '').repeat(generator.count ?? 0)
      : ((c.preimageUtf8 as string) ?? '');
  const namespace = c.namespace as { project: string; environment: string };

  return attempt(() => {
    const key = deriveProtocolCacheKey({
      secret: hexToBytes(c.secretHex as string),
      namespace,
      keyVersion: c.keyVersion as number,
      preimage,
    });
    if (role !== 'success') return { ok: true };
    return {
      ok: true,
      output: {
        key,
        namespaceToken: deriveProtocolCacheNamespaceToken(
          hexToBytes(c.secretHex as string),
          namespace.project,
          namespace.environment,
        ),
      },
    };
  });
}

function handleTaggedValue(role: FixtureRole, c: Case): HandlerResult {
  if (role === 'success') {
    return attempt(() => ({
      ok: true,
      output: {
        canonicalHex: Buffer.from(encodeCanonicalValue(c.value)).toString('hex'),
        sha256: hashCanonicalValue(c.value),
      },
    }));
  }
  return attempt(() => {
    if (c.sourceUtf8 !== undefined) {
      decodeCanonicalValue(c.sourceUtf8 as string);
      return ACCEPT;
    }
    const input = c.generator ? materializeTaggedValue(c.generator as Record<string, unknown>) : c.value;
    validateCanonicalValue(input, { declaredClickHouseType: c.declaredClickHouseType as string | undefined });
    return ACCEPT;
  });
}

function handleIdentifier(role: FixtureRole, c: Case): HandlerResult {
  const simple = c.mode === 'simple';
  if (role === 'success') {
    return attempt(() => {
      const segments = simple
        ? [parseProtocolIdentifier(c.value as string)]
        : splitProtocolQualifiedIdentifier(parseProtocolQualifiedIdentifier(c.value as string));
      return { ok: true, output: { segments } };
    });
  }
  return attempt(() => {
    const input = c.generator ? materializeIdentifier(c.generator as Record<string, unknown>) : (c.value as string);
    if (simple) parseProtocolIdentifier(input);
    else parseProtocolQualifiedIdentifier(input);
    return ACCEPT;
  });
}

function handleExpression(role: FixtureRole, c: Case, section?: string): HandlerResult {
  const isQuery = section === '/queries' || c.mode === 'query';
  const validate = isQuery ? validateProtocolSemanticQuery : validateProtocolExpression;
  if (role === 'success') {
    return attempt(() => {
      validate(c.value);
      return ACCEPT;
    });
  }
  return attempt(() => {
    validate(validationInput(c, materializeExpression));
    return ACCEPT;
  });
}

function handleImplementation(c: Case): HandlerResult {
  const validate = c.surface === 'sql-expression'
    ? validateProtocolSqlExpression
    : validateProtocolQueryImplementation;
  return attempt(() => {
    validate(validationInput(c, materializeImplementation));
    return ACCEPT;
  });
}

function handleDeployment(role: FixtureRole, c: Case): HandlerResult {
  if (role === 'identity') {
    return attempt(() => {
      const prepared = prepareProtocolDeploymentContract(c.value);
      return { ok: true, output: { canonical: prepared.canonical, sha256: prepared.identity } };
    });
  }
  return attempt(() => {
    validateProtocolDeploymentContract(validationInput(c, materializeDeployment));
    return ACCEPT;
  });
}

function handleBundle(role: FixtureRole, c: Case): HandlerResult {
  if (role === 'identity') {
    return attempt(() => {
      const prepared = prepareProtocolDeploymentBundleManifest(c.value);
      return { ok: true, output: { canonical: prepared.canonical, sha256: prepared.identity } };
    });
  }
  return attempt(() => {
    validateProtocolDeploymentBundleManifest(validationInput(c, materializeBundle));
    return ACCEPT;
  });
}

function handleRelease(role: FixtureRole, c: Case): HandlerResult {
  if (role === 'identity') {
    return attempt(() => {
      const prepared = prepareProtocolDeploymentReleaseEnvelope(c.value);
      return { ok: true, output: { canonical: prepared.canonical, sha256: prepared.identity } };
    });
  }
  return attempt(() => {
    validateProtocolDeploymentReleaseEnvelope(validationInput(c, materializeRelease));
    return ACCEPT;
  });
}
