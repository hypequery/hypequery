export interface ProtocolBusinessContextKpi {
  readonly name: string;
  readonly definition: string;
}

export interface ProtocolBusinessContextGlossaryTerm {
  readonly term: string;
  readonly meaning: string;
}

/**
 * Reviewed business context published alongside a deployment contract.
 *
 * This is descriptive guidance for analysts and assistants. It is deliberately
 * separate from the executable deployment contract: the data plane never reads
 * it, and changing it never changes query semantics.
 */
export interface ProtocolBusinessContext {
  readonly kind: 'hypequery-business-context';
  readonly version: 1;
  /** What the business does, in a few sentences. */
  readonly summary?: string;
  readonly industry?: string;
  /** How the business makes money. */
  readonly businessModel?: string;
  /** Who it sells to, and its main segments. */
  readonly customers?: string;
  /** Who asks the questions: roles and teams. */
  readonly audience?: string;
  /** Decisions and recurring questions the data should help with. */
  readonly goals?: readonly string[];
  /** The numbers the business watches, with their business definition. */
  readonly kpis?: readonly ProtocolBusinessContextKpi[];
  /** Business terms and what they mean in this organisation. */
  readonly glossary?: readonly ProtocolBusinessContextGlossaryTerm[];
  /** Reporting conventions: currency, time zone, fiscal year, week start. */
  readonly conventions?: string;
  /** Known data quirks, e.g. test orders or refunds stored elsewhere. */
  readonly caveats?: readonly string[];
}

export interface ProtocolBusinessContextLimits {
  /** Maximum characters in any single text value. */
  readonly maxTextLength: number;
  /** Maximum items in any list (goals, kpis, glossary, caveats). */
  readonly maxItems: number;
  /** Maximum UTF-8 bytes of the canonical encoding. */
  readonly maxBytes: number;
}

export interface ProtocolBusinessContextOptions {
  readonly limits?: Partial<ProtocolBusinessContextLimits>;
}

export type ProtocolBusinessContextErrorCode =
  | 'HQ_BUSINESS_CONTEXT_TYPE'
  | 'HQ_BUSINESS_CONTEXT_UNKNOWN_FIELD'
  | 'HQ_BUSINESS_CONTEXT_INVALID_VERSION'
  | 'HQ_BUSINESS_CONTEXT_INVALID_VALUE'
  | 'HQ_BUSINESS_CONTEXT_DUPLICATE'
  | 'HQ_BUSINESS_CONTEXT_TOO_MANY_ITEMS'
  | 'HQ_BUSINESS_CONTEXT_TOO_LARGE'
  | 'HQ_BUSINESS_CONTEXT_UNSAFE_OBJECT';
