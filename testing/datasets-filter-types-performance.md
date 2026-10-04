# HQ-85 filter type compiler assessment

Measured on 2026-10-03 with TypeScript 5.9.3. The compiler fixture is
`packages/react/type-tests/large-filter-contract.test-d.ts`: 100 local dimensions,
10 to-one relationships with 100 dimensions each, and 10 dataset plus 10 metric
endpoints. It exercises actual dataset → Serve → React inference without recursive
multi-hop expansion.

The baseline was measured before implementation, using the existing React type
suite plus this fixture. The after measurement uses the same suite and fixture,
excluding the new `type-tests/filter-contract.test-d.ts` correctness test so its
additional models do not skew the comparison.

| Extended diagnostic | Before | After |
| --- | ---: | ---: |
| Files | 333 | 333 |
| Types | 25,316 | 26,983 |
| Instantiations | 72,416 | 118,021 |
| Memory used | 163,291 K | 166,416 K |
| Check time | 1.30 s | 1.07 s |

Instantiation work rises about 63% in this deliberately large fixture; memory
rises about 2%. The field/operator unions compile without depth-limit errors.
The timing values are single local runs, subject to machine load, and do not
establish a speedup. The absolute cost remains practical for this workload;
much larger or heavily distinct registries may need separate profiling.

To reproduce the after measurement, create a temporary tsconfig extending
`packages/react/tsconfig.type-tests.json`, exclude the new correctness test by
absolute path, and set `compilerOptions.tsBuildInfoFile` to an absolute temporary
path. Run `pnpm exec tsc --project <temporary-config> --extendedDiagnostics`.
The normal `pnpm --filter @hypequery/react test:types` retains both fixtures.

## Coverage and compatibility

Datasets, Serve, and React type tests cover explicit allowlist aliases,
per-field operators, inferred defaults, `filterable: false`, empty allowlists,
and target filter policies over one-hop `belongsTo` and `hasOne` relationships.
They reject SQL-backed target dimensions, hidden or aliased target fields,
`hasMany`, and multi-hop paths. Widened annotations intentionally retain broad
policies, and existing partially explicit dataset generics remain accepted.

Normal dataset execution no longer silently falls back to the untyped overload.
Explicit result-row generic calls retain the shipped dynamic-query contract.
`validate` and `toSQL` still accept dynamic queries. Values and tenant context
remain runtime checks; HQ-85 constrains allowlist names and operators.

Serve execution now infers inputs from the schema generic instead of its
optional storage property, and endpoint keys cannot widen through input
inference. Tests also cover ordinary Zod default and transform inputs.
