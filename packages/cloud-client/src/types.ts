/** Shared shapes the generated module and the runtime both use. */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Route and policy for one operation, as listed in `OPERATIONS`. */
export interface OperationMeta {
  readonly name: string;
  readonly summary: string;
  readonly scope: 'organization' | 'project';
  /** The capability the caller's role needs. */
  readonly capability: string;
  /** Destructive operations need `confirm: true` in their input. */
  readonly destructive: boolean;
  readonly method: HttpMethod;
  /** Path under the `/v1` base path; `{name}` segments come from the input. */
  readonly path: string;
  readonly pathParams: readonly string[];
  /** Every error code this operation can return. */
  readonly errors: readonly string[];
}

/** One entry of the error catalog. */
export interface CloudErrorSpec {
  readonly status: number;
  readonly category: string;
  readonly retryable: boolean;
  /** The next action, in one sentence. */
  readonly hint: string;
  readonly docsUrl: string;
}

/** Per-call options for any operation method. */
export interface CallOptions {
  /** Abort the request. The fetch's own abort error is rethrown unchanged. */
  readonly signal?: AbortSignal;
  /** Extra headers for this call. */
  readonly headers?: Readonly<Record<string, string>>;
}
