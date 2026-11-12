/**
 * A contract holds something `dataset()` code can't express, so exporting it
 * would change the model. Export refuses rather than writing an approximation
 * (decision 0020 §3); each such feature needs authoring support first.
 */
export class ContractExportError extends Error {
  readonly dataset: string;
  readonly feature: string;

  constructor(dataset: string, feature: string, detail: string) {
    super(`Cannot export ${feature} on dataset "${dataset}": ${detail}`);
    this.name = 'ContractExportError';
    this.dataset = dataset;
    this.feature = feature;
  }
}
