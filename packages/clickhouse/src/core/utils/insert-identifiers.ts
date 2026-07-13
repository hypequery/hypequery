const IDENTIFIER_PART = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertSafeIdentifier(identifier: string, label: string): void {
  if (!IDENTIFIER_PART.test(identifier)) {
    throw new Error(`Unsafe ${label} identifier: ${JSON.stringify(identifier)}.`);
  }
}

export function assertSafeIdentifierPath(identifier: string, label: string): void {
  const parts = identifier.split('.');
  if (parts.length === 0 || parts.some(part => !IDENTIFIER_PART.test(part))) {
    throw new Error(`Unsafe ${label} identifier: ${JSON.stringify(identifier)}.`);
  }
}

export function assertSafeInsertIdentifiers(
  table: string,
  columns?: readonly string[]
): void {
  assertSafeIdentifierPath(table, 'table');
  columns?.forEach(column => assertSafeIdentifierPath(column, 'column'));
}
