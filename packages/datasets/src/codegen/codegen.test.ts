import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  prepareProtocolDeploymentContract,
  validateProtocolDeploymentContract,
  type ProtocolDeploymentContract,
  type ProtocolDeploymentDataset,
} from '@hypequery/protocol';
import { describe, expect, it } from 'vitest';

import { codeAuthoredContract } from '../tests/support/codegen-models.js';
import { uniqueSorted } from '../utils/canonical-json.js';
import { canonicalMemberOrder, ContractExportError, generateDatasetSource } from './index.js';

/**
 * Round-trip fixtures for the TypeScript generator (decision 0020, SOT-02).
 *
 * Each fixture's generated code is committed under `type-tests/codegen/`, where
 * `test:types` typechecks it, and this test:
 *
 * 1. compares the generated files with the committed ones (`vitest -u` updates them);
 * 2. imports the committed `cloud.ts`, whose contract must have the input's identity;
 * 3. regenerates from that contract, which must give the same files (a fixed point).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const fixtures = path.resolve(here, '../../type-tests/codegen');
/** From `type-tests/codegen/<fixture>/` to the package source. */
const importSource = '../../../src/index.js';
/** Runnable copies of the generated files, importing the source by absolute path. */
const scratch = path.resolve(here, '../../.codegen-round-trip');
const sourceIndex = path.resolve(here, '../index.ts');
const header = ['Round-trip fixture for @hypequery/datasets/codegen. Regenerate with `vitest -u`.'];

const readJson = (file: string): unknown => JSON.parse(readFileSync(path.join(root, file), 'utf8'));

/** The endpoints `publishToCloud` derives with open access, for contracts built without it. */
function withDerivedEndpoints(contract: unknown): ProtocolDeploymentContract {
  const validated = validateProtocolDeploymentContract(contract);
  return validateProtocolDeploymentContract({
    ...validated,
    datasets: validated.datasets.map((dataset: ProtocolDeploymentDataset) => ({
      ...dataset,
      endpoint: {
        access: { kind: 'authenticated', roles: [], scopes: [] },
        tenant: dataset.tenant.kind === 'required'
          ? { kind: 'required', mode: 'auto-inject', column: dataset.tenant.field }
          : { kind: 'not-required' },
        maxLimit: dataset.limits?.maxResultSize ?? 1_000,
        path: `/api/analytics/datasets/${String(dataset.name)}/query`,
      },
    })),
  });
}

/**
 * The code-authored model as Cloud's editor leaves it: endpoints no access
 * policy derives, unsorted roles, and a dataset nothing publishes or reaches.
 */
function cloudShapedContract(): ProtocolDeploymentContract {
  const contract = codeAuthoredContract();
  const plans = contract.datasets.find(dataset => dataset.name === 'plans') as ProtocolDeploymentDataset;
  return validateProtocolDeploymentContract({
    ...contract,
    datasets: [
      ...contract.datasets.map(dataset => {
        if (dataset.name === 'invoices') {
          return {
            ...dataset,
            endpoint: {
              access: { kind: 'authenticated', roles: [], scopes: [] },
              tenant: { kind: 'required', mode: 'manual', column: 'tenant_id' },
              cacheTtlMs: 60_000,
              path: '/api/analytics/datasets/invoices/query',
            },
          };
        }
        if (dataset.name === 'accounts' && dataset.endpoint) {
          return {
            ...dataset,
            endpoint: { ...dataset.endpoint, access: { kind: 'authenticated', roles: ['support', 'analyst'], scopes: [] } },
          };
        }
        return dataset;
      }),
      { ...plans, name: 'legacy_plans', source: 'billing.legacy_plans' },
    ].sort((left, right) => (String(left.name) < String(right.name) ? -1 : 1)),
  });
}

const CASES: readonly (readonly [string, () => ProtocolDeploymentContract])[] = [
  ['code-authored', codeAuthoredContract],
  ['cloud-shaped', cloudShapedContract],
  // Built by Cloud's editor tools (apps/web lib/semantic-draft/tools.ts applyTool), as saved.
  ['cloud-editor', () => validateProtocolDeploymentContract(
    JSON.parse(readFileSync(path.join(fixtures, 'cloud-editor/input.json'), 'utf8')),
  )],
  ['spec-common-authoring', () => withDerivedEndpoints(readJson('specs/datasets/common-authoring-v1.json'))],
  ['spec-derived-authoring', () => withDerivedEndpoints(readJson('specs/datasets/derived-authoring-v1.json'))],
  ['spec-merge-authoring', () => withDerivedEndpoints(readJson('specs/datasets/merge-authoring-v1.json'))],
  ...(readJson('specs/security-protocol/fixtures/deployments-v2/success.json') as { id: string; value: unknown }[])
    .map(item => [`conformance-${item.id}`, () => withDerivedEndpoints(item.value)] as const),
];

describe('generateDatasetSource round trip', () => {
  it.each(CASES)('%s', async (name, build) => {
    const contract = build();
    const generated = generateDatasetSource(contract, { importSource, header });
    const directory = path.join(fixtures, name);

    await expect(`${JSON.stringify(contract, null, 2)}\n`).toMatchFileSnapshot(path.join(directory, 'contract.json'));
    await expect(generated.files['datasets.ts']).toMatchFileSnapshot(path.join(directory, 'datasets.ts'));
    await expect(generated.files['cloud.ts']).toMatchFileSnapshot(path.join(directory, 'cloud.ts'));

    // The committed files are only written at the end of a `-u` run, so the
    // contract is built from a copy that differs from them only in its import.
    const built = await buildFromGenerated(name, contract);
    expect(generateDatasetSource(built, { importSource, header }).files).toEqual(generated.files);
  });
});

/**
 * Runs the code generated for `contract` and checks it builds the canonical
 * contract with the same identity; returns what it built.
 */
async function buildFromGenerated(
  name: string,
  contract: ProtocolDeploymentContract,
): Promise<ProtocolDeploymentContract> {
  const runnable = generateDatasetSource(contract, { importSource: sourceIndex, header });
  const copy = path.join(scratch, name);
  rmSync(copy, { recursive: true, force: true });
  mkdirSync(copy, { recursive: true });
  for (const [file, contents] of Object.entries(runnable.files)) writeFileSync(path.join(copy, file), contents);
  const built = (await import(pathToFileURL(path.join(copy, 'cloud.ts')).href)) as {
    cloud: ProtocolDeploymentContract;
  };
  const expected = canonicalMemberOrder(contract);
  expect(prepareProtocolDeploymentContract(built.cloud).identity)
    .toBe(prepareProtocolDeploymentContract(expected).identity);
  expect(built.cloud).toEqual(expected);
  return built.cloud;
}

/** The code-authored contract with `change` applied to its `invoices` dataset. */
function changedInvoices(
  change: (dataset: ProtocolDeploymentDataset) => unknown,
): ProtocolDeploymentContract {
  const contract = codeAuthoredContract();
  return validateProtocolDeploymentContract({
    ...contract,
    datasets: contract.datasets.map(dataset => (dataset.name === 'invoices' ? change(dataset) : dataset)),
  });
}

describe('generateDatasetSource', () => {
  it('imports from @hypequery/datasets and names datasets as generate:datasets does', () => {
    const { files } = generateDatasetSource(codeAuthoredContract());
    expect(files['datasets.ts']).toContain("from '@hypequery/datasets';");
    expect(files['datasets.ts']).toContain("export const DailyActiveUsersDataset = dataset('daily_active_users', {");
    expect(files['cloud.ts']).toContain("import { datasets } from './datasets.js';");
  });

  it('refuses what dataset() code cannot express rather than approximating it', () => {
    const contract = codeAuthoredContract();
    const refuse = (change: (dataset: ProtocolDeploymentDataset) => ProtocolDeploymentDataset) => {
      const changed = validateProtocolDeploymentContract({
        ...contract,
        datasets: contract.datasets.map(dataset => (dataset.name === 'invoices' ? change(dataset) : dataset)),
      });
      return () => generateDatasetSource(changed);
    };
    // A SQL dimension whose declared output isn't the one code derives from its type.
    expect(refuse(dataset => ({
      ...dataset,
      dimensions: dataset.dimensions.map(item => (
        item.source.kind === 'sql-expression'
          ? { ...item, source: { ...item.source, output: { kind: 'number' } } }
          : item
      )) as ProtocolDeploymentDataset['dimensions'],
    }))).toThrow(ContractExportError);
  });

  it('writes the same code whatever order the contract lists members in', () => {
    const contract = codeAuthoredContract();
    const reversed = validateProtocolDeploymentContract({
      ...contract,
      datasets: [...contract.datasets].reverse().map(dataset => ({
        ...dataset,
        dimensions: [...dataset.dimensions].reverse(),
        measures: [...dataset.measures].reverse(),
        filters: [...dataset.filters].reverse(),
      })),
    });
    expect(generateDatasetSource(reversed).files).toEqual(generateDatasetSource(contract).files);
  });

  it('reads formula inputs from `inputs` when one is named like a helper', async () => {
    const contract = changedInvoices(dataset => JSON.parse(
      JSON.stringify(dataset).replaceAll('"alias":"total"', '"alias":"divide"').replaceAll('"name":"total"', '"name":"divide"'),
    ));
    const { files } = generateDatasetSource(contract);
    expect(files['datasets.ts']).toContain(
      "formula: (inputs) => round(divide(inputs['divide'], nullIfZero(inputs['count'])), 2)",
    );
    await buildFromGenerated('helper-named-input', contract);
  });

  it('round-trips metadata and SQL dependencies listed in any order', async () => {
    const contract = changedInvoices(dataset => ({
      ...dataset,
      synonyms: ['sales', 'billing'],
      dimensions: dataset.dimensions.map(item => (
        item.source.kind === 'sql-expression'
          ? { ...item, examples: ['2024-02', '2024-01'], source: {
            ...item.source,
            sql: "concat(status, formatDateTime(issued_at, '%Y-%m'))",
            dependencies: ['status', 'issued_at'],
          } }
          : item
      )),
    }));
    const built = await buildFromGenerated('unsorted-lists', contract);
    const invoices = built.datasets.find(dataset => dataset.name === 'invoices') as ProtocolDeploymentDataset;
    expect(invoices.synonyms).toEqual(['billing', 'sales']);
  });

  it('keeps every header line a comment', () => {
    const { files } = generateDatasetSource(codeAuthoredContract(), { header: ['one\nexport const x = 1;'] });
    expect(files['datasets.ts'].startsWith('// one\n// export const x = 1;\n\n')).toBe(true);
  });

  it('needs at least one published dataset', () => {
    const contract = codeAuthoredContract();
    const unpublished = validateProtocolDeploymentContract({
      ...contract,
      datasets: contract.datasets.map(({ endpoint: _endpoint, ...dataset }) => dataset),
    });
    expect(() => generateDatasetSource(unpublished)).toThrow(ContractExportError);
  });

  it('keeps sorted, deduplicated access in datasetAccess and anything else in endpoints', () => {
    const { files } = generateDatasetSource(cloudShapedContract());
    expect(files['cloud.ts']).toContain('endpoints: {');
    expect(files['cloud.ts']).toContain('supporting: { legacy_plans: LegacyPlansDataset }');
    expect(uniqueSorted(['b', 'a', 'a'])).toEqual(['a', 'b']);
  });
});
