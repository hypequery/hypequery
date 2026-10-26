/** Response metadata the request guarantees: servers return it whenever it is requested. */
type RequiredMeta<Output> = Output extends unknown
  ? 'meta' extends keyof Output
    ? Omit<Output, 'meta'> & { meta: NonNullable<Output['meta']> }
    : Output
  : never;

/** `includeMeta: true` in the input makes `meta` present on the response. */
export type WithRequestedMeta<Output, Input> = Input extends { includeMeta: true }
  ? RequiredMeta<Output>
  : Output;

/** Infinite queries always request metadata (for `meta.pagination`), so every page carries it. */
export type WithPageMeta<Output> = RequiredMeta<Output>;
