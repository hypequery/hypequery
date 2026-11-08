import { z } from 'zod';
import { KEBAB_CASE } from './utils/slug.js';
import { SEMVER } from './utils/semver.js';
import { isSafeRelativePath } from './utils/relative-path.js';

const kebab = (what: string) =>
  z
    .string()
    .regex(KEBAB_CASE, { message: `${what} must be kebab-case (e.g. "nextjs-dashboard")` });

const relativeFile = (what: string) =>
  z
    .string()
    .min(1)
    .refine(isSafeRelativePath, {
      message: `${what} must be a relative path inside the example folder (no leading "/" or "..")`,
    });

/** `@hypequery/<name>` npm packages, or the `hypequery` PyPI package for Python examples. */
export const PackageName = z
  .string()
  .regex(/^(@hypequery\/[a-z0-9-]+|hypequery)$/, {
    message: 'packages entries must be "@hypequery/<name>" (npm) or "hypequery" (PyPI)',
  });

export const EnvVar = z
  .object({
    name: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/, { message: 'env var names must be UPPER_SNAKE_CASE' }),
    description: z.string().min(1),
    required: z.boolean(),
  })
  .strict();

export const RunCommands = z
  .object({
    install: z.string().min(1),
    dev: z.string().min(1),
    test: z.string().min(1),
  })
  .strict();

/**
 * Fields shared by examples and recipes. Kept as a plain object so both
 * manifests extend the same source of truth.
 */
export const ManifestCore = z.object({
  /** Optional editor hint; points at the generated JSON Schema. */
  $schema: z.string().optional(),
  /** Kebab-case; must match the folder name. */
  slug: kebab('slug'),
  title: z.string().min(1).max(120),
  /** One line, hand-written; doubles as the page's meta description. */
  outcome: z.string().min(1).max(160),
  language: z.enum(['typescript', 'python']),
  /** e.g. ['nextjs', 'react'] -> injected into /clickhouse-nextjs etc. */
  stack: z.array(kebab('stack entries')),
  useCases: z.array(kebab('useCases entries')),
  /** e.g. ['@hypequery/serve', ...] */
  packages: z.array(PackageName).min(1),
  /** File shown inline on the page. */
  keyFile: relativeFile('keyFile'),
  env: z.array(EnvVar),
  run: RunCommands,
  /** curl / query an agent can run to verify the example works. */
  exampleRequest: z.string().min(1).optional(),
  /** Slugs of related examples or recipes. */
  related: z.array(kebab('related entries')).default([]),
  /** Existing site URLs this item's block is injected into, e.g. "/clickhouse-nextjs". */
  leadPages: z
    .array(
      z
        .string()
        .regex(/^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/, {
          message: 'leadPages entries must be site paths like "/clickhouse-nextjs"',
        }),
    )
    .default([]),
  /** /clickhouse/functions/<fn> slugs, e.g. "quantile", "tostartofinterval". */
  functionPages: z.array(kebab('functionPages entries')).default([]),
  /** From Search Console, not guesses. */
  keywords: z.array(z.string().min(1)).min(1),
  /** Minimum hypequery version the example is tested against. */
  minVersion: z.string().regex(SEMVER, { message: 'minVersion must be semver (e.g. "1.28.0")' }),
});

export const ExampleManifest = ManifestCore.extend({
  kind: z.literal('example'),
}).strict();

export const RecipeManifest = ManifestCore.extend({
  kind: z.literal('recipe'),
  /** The hypequery dataset definition the recipe is built on. */
  datasetFile: relativeFile('datasetFile'),
  /** The SQL hypequery is expected to generate; asserted by the smoke test. */
  expectedSqlFile: relativeFile('expectedSqlFile'),
  /** Captured output over the seed dataset (table or JSON), shown on the page. */
  outputFile: relativeFile('outputFile'),
}).strict();

export const Manifest = z.discriminatedUnion('kind', [ExampleManifest, RecipeManifest]);

export type ExampleManifest = z.infer<typeof ExampleManifest>;
export type RecipeManifest = z.infer<typeof RecipeManifest>;
export type Manifest = z.infer<typeof Manifest>;
export type ManifestKind = Manifest['kind'];

/** Input shape (before defaults are applied), useful for authoring helpers. */
export type ExampleManifestInput = z.input<typeof ExampleManifest>;
export type RecipeManifestInput = z.input<typeof RecipeManifest>;
