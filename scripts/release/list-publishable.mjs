#!/usr/bin/env node
// Write the `[{ name, version }]` list a publish step is about to publish.
//
//   --out <file>            where to write the JSON list (default: stdout)
//   --prerelease <tag>      only snapshot versions for <tag> (the canary job)
//   --unpublished           only versions that do not yet resolve on npm (the
//                           stable job: what `changeset publish` will attempt)

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { versionResolves } from './utils/npm-registry.mjs';
import { publishablePackages } from './utils/publishable-packages.mjs';
import { readWorkspacePackages } from './utils/workspace-packages.mjs';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    prerelease: { type: 'string' },
    unpublished: { type: 'boolean', default: false },
  },
});

let packages = publishablePackages(readWorkspacePackages(), { prerelease: values.prerelease });
if (values.unpublished) {
  const resolves = await Promise.all(packages.map(versionResolves));
  packages = packages.filter((_, index) => !resolves[index]);
}

const json = `${JSON.stringify(packages, null, 2)}\n`;
if (values.out) {
  writeFileSync(values.out, json);
  console.log(`Recorded ${packages.length} package version(s) in ${values.out}:`);
  for (const pkg of packages) console.log(`  ${pkg.name}@${pkg.version}`);
} else {
  process.stdout.write(json);
}
