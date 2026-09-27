/**
 * Why portable execution excluded a contract surface.
 *
 * Decision 0005 excludes any surface a rebuilt catalog cannot reproduce
 * byte-for-byte rather than approximating it. Every exclusion names one of
 * these reasons, so an operator can tell which surface a deployment tripped on
 * without parsing the message, and the corpus can assert that nothing is
 * refused for an unnamed reason. The wire failure stays
 * `HQ_SEMANTIC_UNSUPPORTED_CAPABILITY`; the reason travels beside it.
 */
export const UNSUPPORTED_CONTRACT_REASONS = {
  /** A measure's fixed filter is not a field/operator/literal comparison. */
  measureFilterNotComparison: 'HQ_PORTABLE_MEASURE_FILTER_NOT_COMPARISON',
  /** A metric input or base metric is not an aggregate expression. */
  expressionNotAggregate: 'HQ_PORTABLE_EXPRESSION_NOT_AGGREGATE',
  /** No declared measure has the aggregation a metric expression names. */
  noMatchingMeasure: 'HQ_PORTABLE_NO_MATCHING_MEASURE',
  /** Two measures share an aggregation but emit different SQL. */
  ambiguousMeasureSql: 'HQ_PORTABLE_AMBIGUOUS_MEASURE_SQL',
  /** A derived metric arrived without the authored formula and aliases. */
  derivedMetricWithoutFormula: 'HQ_PORTABLE_DERIVED_METRIC_WITHOUT_FORMULA',
  /** A derived formula uses an operator, function, or shape with no builder. */
  unsupportedFormula: 'HQ_PORTABLE_UNSUPPORTED_FORMULA',
  /** A relationship names a dataset outside the supplied contract. */
  relationshipTargetMissing: 'HQ_PORTABLE_RELATIONSHIP_TARGET_MISSING',
  /** An invocation filter is not a field/operator/literal comparison. */
  queryFilterNotComparison: 'HQ_PORTABLE_QUERY_FILTER_NOT_COMPARISON',
  /** The invoked dataset is not part of the activated contract. */
  datasetNotActivated: 'HQ_PORTABLE_DATASET_NOT_ACTIVATED',
} as const;

export type UnsupportedContractReason =
  typeof UNSUPPORTED_CONTRACT_REASONS[keyof typeof UNSUPPORTED_CONTRACT_REASONS];
