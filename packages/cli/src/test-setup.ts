import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Commands read stored Cloud credentials from the config directory by default.
// Point it at an empty directory so no test reads or writes a developer's real
// sign-in; tests that need a store pass their own directory.
process.env.HYPEQUERY_CONFIG_DIR = mkdtempSync(path.join(tmpdir(), 'hypequery-cli-test-config-'));
