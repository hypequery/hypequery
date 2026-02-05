# @hypequery/cli

## 0.0.10

### Patch Changes

- ed06077: Ensure the release workflow builds every package before running the Changesets publish step so the CI release ships with fresh `dist` artifacts.
- Updated dependencies [ed06077]
  - @hypequery/serve@0.0.10

## 0.0.9

### Patch Changes

- Re-release to ensure CI builds `dist` artifacts before publishing so the CLI ships with compiled sources.

## 0.0.8

### Patch Changes

- 4bbab53: Enable query execution stats logging in dev server. Removed "Coming soon!" placeholder as the feature is already implemented via `serveDev`.
- Updated dependencies [4bbab53]
  - @hypequery/serve@0.0.7

## 0.0.7

### Patch Changes

- f99e80e: Pre-release improvements:
  - CLI loading spinners, serve runtime fixes, and React integration updates
- Updated dependencies [f99e80e]
  - @hypequery/serve@0.0.4
