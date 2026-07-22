// Conformance adapter for the sql-portability-v1 family. The SQL portability
// compiler lives in @hypequery/datasets, so its adapter lives here rather than
// in the protocol packages (which must not depend on datasets). The runner is
// invoked once per adapter; this one announces only sql-portability-v1.
import { createStdioAdapter } from '@hypequery/protocol-conformance';
import { compilePortableSqlExpression } from '../dist/sql-portability.js';

function sqlForCase(fixtureCase) {
  if (typeof fixtureCase.sql === 'string') return fixtureCase.sql;
  const spec = fixtureCase.sqlRepeat;
  if (spec) {
    return `${spec.prefix ?? ''}${(spec.value ?? '').repeat(spec.count ?? 0)}${spec.suffix ?? ''}`;
  }
  throw new Error(`sql-portability case ${fixtureCase.id} has no sql source`);
}

function handle(_family, role, fixtureCase) {
  const result = compilePortableSqlExpression(sqlForCase(fixtureCase));
  if (result.portable) {
    if (role === 'portable' || role === 'fuzz') {
      return { ok: true, output: { expression: result.expression, dependencies: result.dependencies } };
    }
    return { ok: true };
  }
  const issue = result.issues[0];
  return { ok: false, code: issue.code, output: { start: issue.start } };
}

createStdioAdapter({
  implementation: '@hypequery/datasets',
  language: 'typescript',
  families: ['sql-portability-v1'],
  handle,
})
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exit(1);
  });
