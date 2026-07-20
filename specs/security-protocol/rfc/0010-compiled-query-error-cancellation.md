# RFC 0010: Compiled query, error, and cancellation contract

- Status: Proposed
- Version: compiled query 1

## Summary

This RFC defines the execution request contract between Hypequery runtimes
and database adapters: a compiled query with named typed parameters, a closed
operation set, bounded settings, an authoritative query identifier, explicit
deadline and cancellation precedence, a non-executable debug form, and a
stable public error envelope.

A compiled query is the only way a runtime asks an adapter to execute. SQL
text is always trusted build or server output; callers influence execution
only through declared parameters. Nothing in this contract lets a request
author SQL, tenant proof, or settings — the capability boundary from RFC 0009
applies to every field.

## Parameters

Parameters are named and typed. A parameter name is an RFC 0002 parameter
identifier; a parameter value is an RFC 0001 tagged value. The compiled query
carries its parameter declarations — name, logical type, and optionality —
beside the SQL text, and a request supplies only values for declared names.

- Values are transmitted to the database through the native server-parameter
  mechanism. A parameter value MUST NOT be rendered into SQL text on any
  network path.
- An adapter MUST reject execution when SQL text references an undeclared
  parameter, when a supplied name is not declared, or when a required value is
  absent. These checks fail closed before any network call.
- Parameter declarations and values are bounded by the value limits of
  RFC 0001; products may lower but not raise those bounds.

## Operations

The operation set is closed: `query` returns a result set or stream,
`command` returns an acknowledgement without a result set, and `insert`
accepts a typed row batch. The operation is part of the compiled query, not
the request. An adapter MUST NOT accept an operation, SQL text, or row batch
shape that does not match the compiled query it is executing.

Raw SQL authored outside the trusted build is not representable in this
contract. Tenant-scoped interfaces receive a compiled query whose SQL already
contains the tenant predicates applied by the trusted planner; a request can
never supply or widen them.

## Settings

Settings are a closed, typed allow-list applied per execution, such as a
maximum execution time or result row ceiling. The contract defines each
setting's name, value type, and inclusive range; products may tighten but not
loosen a range.

Settings originate only from trusted components — deployment policy or
adapter defaults. A request MUST NOT set, override, or relax any setting,
directly or through a parameter. Adapter-enforced ceilings always apply, so a
compiled query can request less work than the ceiling but never more.

## Query identifier

Every execution carries a server-generated authoritative query identifier:
unique per execution, unguessable, and safe for logs and cache metadata. A
caller may attach a separately named external correlation identifier, which
is bounded, validated, and never treated as authoritative. The two
identifiers are distinct fields; the correlation value MUST NOT influence
routing, cache keys, or authorization.

## Deadline and cancellation precedence

An execution ends for exactly one of four reasons, with this precedence:

1. **Caller cancellation.** The caller's abort signal wins over every other
   outcome already in progress, including a deadline race, and produces the
   aborted category.
2. **Deadline.** A caller-supplied or policy-derived deadline cancels
   execution at expiry, including server-side work, and produces the
   deadline category unless caller cancellation landed first.
3. **Disconnect.** A client disconnect is treated as caller cancellation;
   server-side work is cancelled rather than left running.
4. **Drain.** A draining runtime stops admitting new executions but lets
   in-flight executions finish until the drain deadline; only then does it
   cancel the remainder. Drain never preempts an execution before that
   deadline and never blocks new admission longer than the drain window.

Cancellation is not advisory: the adapter MUST propagate it to the database
so interrupted work stops consuming server resources. An execution reports
its terminal reason honestly; a cancelled execution is never reported as a
success or converted into a retry without the caller's signal still open.

## Debug form

Every compiled query has a redacted debug form for logs and diagnostics. The
debug form shows SQL structure with parameter placeholders and declared
types. It MUST NOT contain parameter values, tenant values, credentials, or
settings beyond their names. The debug form is not executable: placeholder
syntax is deliberately invalid as database SQL, and no adapter accepts the
debug form as input. Rendered debug output that could be pasted into a client
and run with real values is a conformance failure.

## Error envelope

Execution failures use one stable public envelope: an error object with a
closed category, a safe message, and the authoritative query identifier.
Version 1 minimum categories:

| Category | Meaning |
| --- | --- |
| `input-invalid` | Parameters, names, or values failed validation |
| `unauthenticated` | Credentials absent or rejected |
| `forbidden` | Principal lacks required access |
| `tenant-required` | Tenant context required but absent |
| `not-found` | Named route, query, or artifact absent |
| `too-large` | Request or result exceeded a bound |
| `aborted` | Caller cancellation or disconnect |
| `deadline-exceeded` | Deadline expiry |
| `unavailable` | Executor or dependency unavailable |
| `internal` | Any other failure |

Categories are closed and stable within the version; new categories require a
new contract version. Messages for `internal` and other server-fault
categories MUST NOT expose adapter error text, SQL, values, or tenant
identifiers; client-fault categories may carry a safe message. The error
envelope is the only execution-failure shape a runtime may surface.

## Security

This contract keeps the request plane small: values move as typed parameters,
behavior moves as trusted compiled SQL, and policy moves as settings applied
by trusted components. Combined with RFC 0009, a request can neither author
execution logic nor prove tenant or administrative status, and its failure
surface is a closed envelope that cannot leak values, SQL, or credentials.
