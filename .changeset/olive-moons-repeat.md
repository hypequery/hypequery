---
"@hypequery/clickhouse": minor
---

Stop leaking the CLI into browser bundles from the package root.

`dist/index.js` re-exported `generateTypes` from `./cli/index.js`, which imports
`fs/promises`, `path`, and `dotenv`. Any client-reachable import of
`@hypequery/clickhouse` therefore pulled Node builtins into the browser graph and
failed the build outright:

```
./node_modules/@hypequery/clickhouse/dist/cli/generate-types.js:2:1
Error: Module not found: Can't resolve 'fs/promises'
```

The package root is now resolved by condition: `browser` (and the fallback
`default`) get the browser-safe entry, while `node` gets a new `index.node.js`
that re-exports everything plus `generateTypes`. No export is removed — Node
consumers importing `generateTypes` from the package root keep working.

One behaviour change worth noting: projects on `moduleResolution: "bundler"`
resolve the `default` condition, so `generateTypes` no longer appears on the root
*type* surface there. Import it from `@hypequery/clickhouse/cli`, which is
condition-independent and has always been the intended home for build-time
helpers.

`verify-build.js` already asserted "dist/index.js should not export CLI modules",
but only matched the literal `./cli/generate-types.js`, so a re-export via
`./cli/index.js` slipped past it. The check now matches any import or export
statement targeting `./cli/`, and unit tests cover both entry points and the
exports map.
