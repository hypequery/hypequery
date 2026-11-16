/**
 * Operations the CLI deliberately has no command for, each with the reason.
 * Every other operation in operations-v1.json gets `hypequery <group> <action>`:
 * Cloud offers every operation on `/v1` and the CLI, and its `surfaces` field
 * only ever narrows the connector (decision 0019 §3). The parity test fails on
 * an operation with neither a command nor an entry here, and on an entry
 * without a reason or for an operation that no longer exists.
 */
export const CLI_EXEMPT_OPERATIONS: Readonly<Record<string, string>> = {};
