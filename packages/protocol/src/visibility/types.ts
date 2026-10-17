/** Every field of its kind, including ones a later release adds. */
export type ProtocolVisibleFields = '*' | readonly string[];

export interface ProtocolDatasetVisibility {
  readonly dimensions: ProtocolVisibleFields;
  readonly measures: ProtocolVisibleFields;
}

/**
 * Which datasets and fields a principal may see and query (RFC 0018).
 *
 * An allowlist: a dataset absent from `datasets` is hidden entirely, and a
 * field absent from its dataset's list is hidden. It narrows what the
 * contract publishes and never widens it.
 */
export interface ProtocolFieldVisibility {
  readonly kind: 'hypequery-field-visibility';
  readonly version: 1;
  readonly datasets: Readonly<Record<string, ProtocolDatasetVisibility>>;
}

/** What one dataset exposes under a visibility policy. */
export interface ProtocolVisibleDatasetFields {
  /** Local dimension names and one-hop `relationship.dimension` names. */
  readonly dimensions: ReadonlySet<string>;
  readonly measures: ReadonlySet<string>;
  /** Declared filter names whose field is a visible dimension. */
  readonly filters: ReadonlySet<string>;
  /** Whether the dataset's time field may be grouped by (`by`). */
  readonly timeField: boolean;
}

export type ProtocolFieldVisibilityErrorCode = 'HQ_VISIBILITY_INVALID' | 'HQ_VISIBILITY_TOO_LARGE';
