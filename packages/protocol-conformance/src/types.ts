// Shared types for the conformance manifest, the wire protocol between the
// runner and an adapter, and the enumerated cases the runner drives. See
// specs/security-protocol/rfc/0012-cross-language-conformance.md.

export const CONFORMANCE_PROTOCOL_VERSION = 1;
export const CONFORMANCE_MANIFEST_VERSION = 1;

export type FixtureRole =
  | 'success'
  | 'rejection'
  | 'identity'
  | 'portable'
  | 'non-portable'
  | 'fuzz';

export interface ManifestFileEntry {
  readonly path: string;
  readonly role: Exclude<FixtureRole, 'fuzz'>;
  /** JSON pointers to the case arrays when the file root is not an array. */
  readonly sections?: readonly string[];
}

export interface ManifestFamily {
  readonly name: string;
  readonly rfc?: string;
  readonly codePrefixes: readonly string[];
  readonly files: readonly ManifestFileEntry[];
}

export interface ManifestFuzzEntry {
  readonly path: string;
  /** Default target family when a seed does not carry its own `targets`. */
  readonly family?: string;
}

export interface ConformanceManifest {
  readonly kind: 'hypequery-conformance-manifest';
  readonly version: number;
  readonly families: readonly ManifestFamily[];
  readonly fuzz: readonly ManifestFuzzEntry[];
}

/** A single case the runner sends to an adapter. */
export interface EnumeratedCase {
  readonly family: string;
  readonly role: FixtureRole;
  readonly id: string;
  /** JSON pointer the case was read from, when the file declared sections. */
  readonly section?: string;
  readonly case: Record<string, unknown>;
}

/**
 * RFC 0012 requires every implementation to declare a language-specific
 * hostile-object suite covering the conversion mechanisms the shared
 * `unsafe-accessor` generator cannot describe. The declaration travels in the
 * adapter's `hello` message so it lands in the published run summary.
 */
export interface HostileObjectSuiteDeclaration {
  /** Number of cases in the implementation's own suite. */
  readonly count: number;
  /** Conversion mechanisms covered, e.g. `getter`, `toJSON`, `__str__`. */
  readonly mechanisms: readonly string[];
}

export interface AdapterHello {
  readonly type: 'hello';
  readonly protocol: number;
  readonly implementation?: string;
  readonly version?: string;
  readonly language?: string;
  readonly families: readonly string[];
  readonly hostileObjectSuite?: HostileObjectSuiteDeclaration;
}

export type HandlerResult =
  | { readonly ok: true; readonly output?: Record<string, unknown> }
  | { readonly ok: false; readonly code: string; readonly output?: Record<string, unknown> }
  | { readonly skipped: true; readonly reason?: string };

export type CaseResult = HandlerResult & { readonly type: 'result'; readonly seq: number };

export type CaseStatus = 'pass' | 'fail' | 'skip';

export interface CaseOutcome {
  readonly family: string;
  readonly role: FixtureRole;
  readonly id: string;
  readonly status: CaseStatus;
  readonly expected?: string;
  readonly actual?: string;
  readonly message?: string;
}

export interface RunSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  /** Cases whose family the adapter did not announce. */
  readonly notRun: number;
  readonly adapter?: {
    readonly implementation?: string;
    readonly version?: string;
    readonly language?: string;
    readonly families: readonly string[];
    readonly hostileObjectSuite?: HostileObjectSuiteDeclaration;
  };
  readonly outcomes: readonly CaseOutcome[];
}
