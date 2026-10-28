- Publish a dataset's `description` in deployment contracts and bundles, matching
  TypeScript. The contract has no dataset-level label, so `Dataset.label` is not
  published there. Descriptions follow the existing deployment text rules: blank,
  multi-line, control-character or over-4096-byte text fails the export.
