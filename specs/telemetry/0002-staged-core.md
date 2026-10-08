# Staged telemetry core

Implements HQ-235/HQ-237/HQ-238/HQ-239/HQ-241 and the central lifecycle portion
of HQ-240/HQ-251. Default collection stays inactive while the first-party proxy,
privacy/legal review and rollout are unfinished. `HYPEQUERY_TELEMETRY_DEBUG=1`
activates local inspection; `HYPEQUERY_TELEMETRY_URL` activates explicit staging
delivery. Both obey all saved, environment and flag opt-outs. Preference commands
emit nothing. Help for preference commands is an ordinary help event.

## Local context and identity

Inspect bounded regular files only, without git subprocesses, module imports or
database/network requests. Discover the nearest package and workspace root and
resolve `.git` files and `commondir` for managed worktrees. Prefer the origin
remote, falling back to another remote. Strip credentials, query, fragment,
transport and default ports before hashing; retain custom ports to avoid
collisions. Equivalent SCP SSH, SSH URL, HTTPS and git URL forms share a project
ID. Local file remotes are ineligible. Fall back to the workspace root package
name; omit the project ID when neither signal exists. Use the shared global
salt, and require ingest-side HMAC re-keying before storage.

Install IDs are lazily generated UUIDs stored in the locked preferences file;
each invocation has one new random session UUID. Collect only CI/platform enums,
environment booleans, package-manager enums/major versions, invocation enums and
allowlisted exact installed package versions. Dependency ranges and file/git
specs become `unknown`. Backend intent reuses the existing environment detector
and local chDB dependency presence; env-file values are already loaded by the CLI.

Project discovery and the environment collector each stop additional file reads
after a 5 ms budget. Individual filesystem calls cannot be interrupted; slow
filesystem mounts can exceed that budget. An unavailable field is unknown or
omitted and never causes a command failure. No environment values or inspected
paths are included in event properties.

## Disclosure and transport

Display the notice on stderr only, once, TTY-only, never in CI, MCP or preference
commands. Serialize disclosure across CLI processes using the settings lock and
persist the timestamp only after stderr's write callback succeeds.

Settings writes hold a cross-process lock: a directory containing one owner file
named for the writer's process ID, host and a random token, published by atomic
rename. A live owner keeps its lock however long it runs; age is never evidence
of abandonment, because a slow or suspended writer is still alive. A lock whose
owner process no longer exists on this host (a crash, SIGKILL or power loss) is
taken over by renaming that exact owner file to the new owner's name, which fails
if the lock was already replaced, so concurrent recoverers cannot both win.
Release removes only the writer's own owner file. A lock owned on another host
cannot be checked and fails closed. On ordinary exits and signals the executable
also waits, bounded at 250 ms, for in-flight writes to release their lock.

One in-memory PostHog-shaped batch has at most 32 events and 64 KiB. The
`api_key: hypequery-cli` routing marker is not a PostHog credential; the proxy owns
the real key. Add only transport-owned timestamp, distinct ID, person-profile and
GeoIP-disable fields after validating and snapshotting the catalog payload.
Never follow redirects. Only HTTPS or loopback HTTP without credentials, query
or fragment is accepted. With debug enabled, print exactly those event envelopes
to stderr and skip sending. Diagnostic text never includes rejected data.

Flush is capped at 40 ms with an abort controller and an unref'ed timeout.
Delivery uses `node:http(s)`, not the built-in fetch: aborting fetch rejects on
time, but its pending TCP or TLS connect kept the process alive for the ~10 s
connect timeout against an unreachable endpoint. Aborting the Node request
destroys its socket even mid-connect, so the CLI exits once the flush returns.
Synchronous throws, network errors and non-success HTTP responses are swallowed.
There are no retries or disk queues. HTTP 410 requests a best-effort,
version-specific opt-out, written asynchronously with one immediate lock attempt;
an unavailable lock cannot prolong exit by waiting for a writer.
The kill switch leaves saved consent and other CLI versions unchanged.

## Lifecycle

Commander preAction initializes command context. Help/version and parse failures
initialize context through the executable's exit override. Unknown commands and
options are classified as unknown, never their raw input. Completion is emitted
exactly once. Raw argument values are discarded by the flag-name allowlist.

All former direct command exits call a focused exit helper. While the executable
owns finalization, that helper throws a typed exit request, preserving already
printed diagnostics. Standalone command calls retain the original immediate-exit
behavior. Prompt cancellation remains exit 130; explicit init declines retain
exit 0. Dev/MCP signal endings are interrupted. Dev's existing asynchronous
teardown finishes before the centralized flush/exit. Module-loader cleanup no
longer installs an independent signal exit that bypasses server teardown.

Node's uncaughtExceptionMonitor captures uncaught exceptions and fatal unhandled
rejections with a built-in exception-class enum and stable code. Native fatal
diagnostics and termination are preserved. Debug crash envelopes are synchronous;
network delivery during fatal termination is best-effort and may be dropped.

## Verification

CLI tests build the executable before running subprocess regressions. Every help
page and safe failure/logout path compares exit codes and ordinary output with
telemetry disabled, debug-enabled and a failing ingest endpoint. Real dev
shutdown verifies teardown on SIGINT. Unit tests cover concurrent notice display,
identity normalization, metadata faults, CI/provider enums, payload privacy,
batch caps, HTTP failures and a blackholed endpoint. A compiled-CLI test checks
that an endpoint which never completes its TLS handshake does not delay exit.

`pnpm --filter @hypequery/cli telemetry:benchmark` measures 30 paired compiled CLI
invocations with a blackholed server and enforces less than 100 ms of additional
exit latency at p99. The flush cap was reduced from 75 ms after that configuration
exceeded the budget. Command-specific aggregates and the feature-usage snapshot
are subsequent instrumentation tasks, not inferred from user code here.
