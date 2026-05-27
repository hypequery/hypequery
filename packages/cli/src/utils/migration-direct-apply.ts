import { splitMigrationStatements } from './migration-statements.js';
import type { MigrationExecutionClient } from './migration-remote-state.js';

export interface ApplyMigrationSqlDirectlyResult {
  appliedStepCount: number;
  totalSteps: number;
}

export async function applyMigrationSqlDirectly(
  client: Pick<MigrationExecutionClient, 'command'>,
  sql: string,
): Promise<ApplyMigrationSqlDirectlyResult> {
  const statements = splitMigrationStatements(sql);
  if (statements.length === 0) {
    throw new Error('Push produced no executable SQL statements.');
  }

  let appliedStepCount = 0;

  try {
    for (const statement of statements) {
      await client.command({ query: statement });
      appliedStepCount += 1;
    }
  } catch (error) {
    throw new Error(
      `Push failed at statement ${appliedStepCount + 1}/${statements.length}. ` +
      'ClickHouse DDL is not transactional; partial side effects may already exist. ' +
      `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    appliedStepCount,
    totalSteps: statements.length,
  };
}
