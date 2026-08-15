#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const packagesRoot = path.join(repoRoot, 'packages');
const expectedHomepage = 'https://hypequery.com';
const expectedRepositoryUrl = 'git+https://github.com/hypequery/hypequery.git';
const expectedBugsUrl = 'https://github.com/hypequery/hypequery/issues';

const packageDirectories = fs
  .readdirSync(packagesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((directory) => fs.existsSync(path.join(packagesRoot, directory, 'package.json')))
  .sort();

const errors = [];

for (const directory of packageDirectories) {
  const relativeFile = path.posix.join('packages', directory, 'package.json');
  const relativeReadme = path.posix.join('packages', directory, 'README.md');
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repoRoot, relativeFile), 'utf8'),
  );
  const expectedDirectory = path.posix.join('packages', directory);

  if (!fs.existsSync(path.join(repoRoot, relativeReadme))) {
    errors.push(`${relativeReadme}: package README is required for npm`);
  } else if (
    fs.readFileSync(path.join(repoRoot, relativeReadme), 'utf8').trim().length === 0
  ) {
    errors.push(`${relativeReadme}: package README must not be empty`);
  }

  if (packageJson.homepage !== expectedHomepage) {
    errors.push(
      `${relativeFile}: homepage must be ${expectedHomepage} (received ${JSON.stringify(packageJson.homepage)})`,
    );
  }

  if (packageJson.repository?.type !== 'git') {
    errors.push(`${relativeFile}: repository.type must be "git"`);
  }

  if (packageJson.repository?.url !== expectedRepositoryUrl) {
    errors.push(
      `${relativeFile}: repository.url must be ${expectedRepositoryUrl}`,
    );
  }

  if (packageJson.repository?.directory !== expectedDirectory) {
    errors.push(
      `${relativeFile}: repository.directory must be ${expectedDirectory}`,
    );
  }

  if (packageJson.bugs?.url !== expectedBugsUrl) {
    errors.push(`${relativeFile}: bugs.url must be ${expectedBugsUrl}`);
  }

  if (!Array.isArray(packageJson.keywords) || packageJson.keywords.length === 0) {
    errors.push(`${relativeFile}: keywords must be a non-empty array`);
  }
}

if (errors.length > 0) {
  console.error('Package metadata check failed:\n');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(
  `Package metadata check passed for ${packageDirectories.length} packages.`,
);
