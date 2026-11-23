#!/usr/bin/env node
// Public API reports (API Extractor) for the packages whose types downstream
// consumers compile against. One report per `exports` entry point, committed
// under packages/<pkg>/api-report/. Needs built `dist/` (pnpm build first).
//
//   node scripts/api-report.mjs           regenerate the committed reports
//   node scripts/api-report.mjs --check   fail if a report is missing or stale
//
// Policy: CLAUDE.md ("Public API reports"); decision 0030.

import { Extractor, ExtractorConfig, ExtractorLogLevel } from '@microsoft/api-extractor';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { apiReportEntryPoints } from './utils/api-report-entry-points.mjs';

const API_REPORT_PACKAGES = ['packages/protocol', 'packages/datasets', 'packages/deployment'];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const tempRoot = mkdtempSync(join(tmpdir(), 'hypequery-api-report-'));

function extractorConfig(packageDir, entry) {
  const projectFolder = join(root, packageDir);
  return ExtractorConfig.prepare({
    configObjectFullPath: join(projectFolder, 'api-extractor.json'),
    packageJsonFullPath: join(projectFolder, 'package.json'),
    configObject: {
      projectFolder,
      mainEntryPointFilePath: join(projectFolder, entry.types),
      bundledPackages: [],
      newlineKind: 'lf',
      // The analysis reads only the built .d.ts files, so it uses one fixed set
      // of options rather than each package's build tsconfig. DOM is in `lib`
      // because API Extractor cannot follow @types/node's conditional global
      // declarations (e.g. AbortSignal) without it.
      compiler: {
        overrideTsconfig: {
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            lib: ['ES2023', 'DOM', 'DOM.Iterable'],
            types: ['node'],
            strict: true,
            skipLibCheck: true,
            esModuleInterop: true,
          },
          files: [join(projectFolder, entry.types)],
        },
      },
      apiReport: {
        enabled: true,
        reportFileName: entry.reportName,
        reportFolder: join(projectFolder, 'api-report'),
        reportTempFolder: join(tempRoot, packageDir),
        // Inline declarations the entry point uses but does not export, so a
        // change to them shows in the report too.
        includeForgottenExports: true,
      },
      docModel: { enabled: false },
      dtsRollup: { enabled: false },
      tsdocMetadata: { enabled: false },
      messages: {
        compilerMessageReporting: { default: { logLevel: 'error' } },
        // Report findings such as ae-forgotten-export appear as comments in the
        // report itself; they are not build failures.
        extractorMessageReporting: { default: { logLevel: 'none' } },
        tsdocMessageReporting: { default: { logLevel: 'none' } },
      },
    },
  });
}

const stale = [];
let failed = false;

for (const packageDir of API_REPORT_PACKAGES) {
  const packageJson = JSON.parse(readFileSync(join(root, packageDir, 'package.json'), 'utf8'));
  const entries = apiReportEntryPoints(packageJson);
  mkdirSync(join(root, packageDir, 'api-report'), { recursive: true });

  for (const entry of entries) {
    const label = `${packageJson.name}${entry.subpath === '.' ? '' : entry.subpath.slice(1)}`;
    if (!existsSync(join(root, packageDir, entry.types))) {
      console.error(`::error::${label}: ${entry.types} is missing. Build first: pnpm turbo run build --filter=${packageJson.name}`);
      failed = true;
      continue;
    }
    const result = Extractor.invoke(extractorConfig(packageDir, entry), {
      localBuild: !check,
      messageCallback: (message) => {
        if (message.logLevel === ExtractorLogLevel.Error) console.error(`${label}: ${message.text}`);
        message.handled = true;
      },
    });
    const reportPath = join(packageDir, 'api-report', `${entry.reportName}.api.md`);
    if (result.errorCount > 0) {
      console.error(`::error::${label}: API Extractor reported ${result.errorCount} error(s).`);
      failed = true;
    } else if (check && result.apiReportChanged) {
      stale.push({ label, reportPath, tempPath: join(tempRoot, packageDir, `${entry.reportName}.api.md`) });
    } else {
      console.log(`${label}: ${result.apiReportChanged ? 'updated' : 'unchanged'} ${reportPath}`);
    }
  }

  // A report for an entry point that no longer exists is stale too.
  const expected = new Set(entries.map((entry) => `${entry.reportName}.api.md`));
  for (const file of readdirSync(join(root, packageDir, 'api-report'))) {
    if (!file.endsWith('.api.md') || expected.has(file)) continue;
    const reportPath = join(packageDir, 'api-report', file);
    if (check) stale.push({ label: packageJson.name, reportPath, removed: true });
    else rmSync(join(root, reportPath));
  }
}

for (const { label, reportPath, tempPath, removed } of stale) {
  console.error(`::error file=${reportPath}::${label}: public API changed but ${reportPath} was not ${removed ? 'removed' : 'updated'}.`);
  if (tempPath && existsSync(tempPath)) {
    const committed = existsSync(join(root, reportPath)) ? join(root, reportPath) : '/dev/null';
    spawnSync('diff', ['-u', committed, tempPath], { stdio: 'inherit' });
  }
}
rmSync(tempRoot, { recursive: true, force: true });

if (stale.length > 0) {
  console.error([
    '',
    'Run `pnpm api:report` after building, commit packages/*/api-report/, and add a',
    'changeset for each changed package with a `Consumer-breaking:` line (see CLAUDE.md).',
  ].join('\n'));
}
if (failed || stale.length > 0) process.exit(1);
