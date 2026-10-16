# RFC 0018: Semantic client contract

- Status: Accepted
- Date: 2026-10-15
- Artifact version: semantic client contract 1
- Implementation track: PX-01 through PX-08, Python integrated beta
- Changes no existing deployment, expression, invocation or catalog version

## Status and purpose

This RFC defines a bounded logical contract for registered dataset and
measure-backed metric HTTP endpoints. It supplies frontend type/route generation
and an HTTP-backed MCP executor without exposing executable definitions.

The data format, validators and compiler were reviewed in PX-02; see the
[acceptance record](../decisions/0018-client-contract-acceptance.md). Normative
vectors live in [client-contract-v1](../fixtures/client-contract-v1/README.md)
and are registered in conformance. Acceptance covers the data format and strict
query profile. HTTP registration/discovery, generation, React and the MCP bridge
retain their own implementation and release gates.

## Trust and compatibility boundary

The contract advertises operations; it never grants permission to execute them.
Python continues to authenticate, authorize, resolve tenancy, validate semantics
and execute every request. A consumer must not construct SQL, reconstruct business
formulas or infer hidden routes from the contract.

There are two explicit views:

- **build**: a trusted host exports an audience's configured endpoints offline.
  It is suitable for build-time code generation, not proof that any particular
  user can invoke all of them. The host decides whether to publish this view.
- **authorized**: the server projects only endpoints currently executable by the
  authenticated principal and trusted tenant context. A discovery-route policy
  is an additional gate, not permission to expose all registered endpoints.

Two tenants with identical logical entitlements may receive identical contract
bytes. Consequently neither hash in this RFC is a credential, tenant identifier,
cache-isolation scope or authorization-cache key. Execution still authorizes on
every request. A cached view must never be transferred to another principal.

Existing semantic/deployment artifacts remain unchanged. Removing SQL from a
trusted catalog does not produce this contract: physical sources, columns,
relationship keys and tenant keys are also excluded here. Legacy discovery
responses and existing HTTP request behavior do not change merely because this
RFC is accepted; endpoint adapters explicitly opt into this client profile.

## Document

The root is a closed object with exactly:

| Member | Meaning |
| --- | --- |
| kind | Literal hypequery-client-contract |
| version | Integer 1; booleans are not integers |
| view | build or authorized |
| endpoints | Array of closed endpoint objects, possibly empty |
| contentHash | Lowercase 64-character hexadecimal view identity |

Unknown members fail closed at every object level. In version 1 there is no
arbitrary metadata/extension map, origin/base URL, credential transport, token,
tenant, role/scope requirement or connection configuration. An unknown version
must be refused before interpreting its endpoints. Values cannot be coerced.
JSON integer constraints are evaluated by numeric value after the shared
binary64 interpretation: 1.0 and 1 are equivalent, while true and "1" are not
numbers. Do not introduce a Python-only distinction between integral JSON float
spellings and TypeScript's single number type. All metadata integers are safe
integers within the explicit bounds below.

Endpoint registration and offline export are host APIs, not protocol-defined
Python constructors. The artifact is plain JSON and contains no callbacks,
imports, module paths, Python source or executable expressions.

## Endpoint identity and route binding

Every endpoint has these required members:

| Member | Meaning |
| --- | --- |
| id | Globally unique simple logical export identifier |
| kind | dataset or metric |
| dataset | Simple logical dataset group identifier |
| path | Absolute path relative to the configured backend origin |
| dimensions | Record of logical dimension descriptors |
| measures | Record of logical measure descriptors |
| filters | Record of query filter descriptors, including aliases |
| time | null or a time descriptor |
| metadata | Whether includeMeta=true is supported |
| limits | Explicit client-profile ceilings/defaults |
| schemaHash | Lowercase 64-character hexadecimal endpoint schema identity |

A dataset endpoint additionally requires defaultMeasures. A metric endpoint
forbids that member and has exactly one measure entry, whose key is its output
alias. Endpoint kind must be inspected before deciding this closed shape.

Simple names follow RFC 0002. Dimension/measure/filter keys may contain one or
two simple segments separated by a dot, to describe supported one-hop fields.
Deeper traversal is not an implied execution capability. Comparisons are exact
and case-sensitive. Member names cannot be normalized, trimmed or case-folded.

A dataset endpoint's id must equal dataset. Thus query_dataset's dataset input
maps unambiguously to one registered dataset endpoint. A metric endpoint's id
must differ from dataset and is its query_metric metric identifier. Its dataset
need not have a visible dataset endpoint: a metric-only view is valid. Metric
ids are globally unique, so metric aliases from different datasets need explicit
distinct export ids when necessary. The output alias can differ from the id.

React keys are derived, never separately authored: dataset:<id> for dataset
endpoints and <id> for metrics, matching existing hook conventions. A Python
variable name or URL segment does not define an export identity. Multiple routes
to one underlying dataset need explicit distinct logical export bindings; a
producer must not let duplicate ids overwrite one another.

Routes in this version are POST. Path must match
/(?:[A-Za-z0-9_~.-]+/)*[A-Za-z0-9_~.-]+, with no dot-only navigation segment
(one dot or two dots).
An absolute URL, authority, percent escape, query, fragment, backslash, route
template, empty segment, trailing slash or non-ASCII character is invalid.
The root path / is not supported by this version.

The path includes the explicitly configured application/router/mount prefix.
It does not include a user-selected origin. Products that cannot determine their
proxy mount must require a trusted host value, not infer it from caller headers.
Resolving a path must retain the configured origin and must not follow redirects
with credentials. A backend origin itself is trusted executor configuration.

Two endpoints cannot have the same path. Distinct logical bindings cannot cause
the same POST to receive contradictory descriptors. Static path restrictions
are deliberate version-1 limits, not a promise to export every possible ASGI
route. Unsupported paths fail export rather than being escaped or guessed.

## Dimension and measure descriptors

A dimension descriptor is closed and requires:

- type: string, number, boolean or timestamp; the logical filter/input category.
- wireType: string, number, boolean or number-or-string; the HTTP scalar type.
- nullable: true, false or unknown (the literal string).
- groupable: boolean; whether it can be selected as a grouping dimension.
- orderable: boolean; whether the selected dimension can be ordered.

string/timestamp logical types require string wire type, boolean requires
boolean, and number permits number, string or number-or-string. Numbers are
finite binary64 JSON numbers at the client boundary. Numeric dimensions may
decode as decimal strings; producers lacking authoritative wire information must
advertise number-or-string rather than infer number solely from dimension.number.
This descriptor does not repair precision already lost by a backend serializing
an unsafe integer as a JSON number. Consumers must not claim exact numeric
dimension precision based only on the logical type. Semantic measure precision
uses the separate string contract below.

nullable=false is an explicit output guarantee, not the absence of a physical
Nullable annotation in an incomplete catalog. unknown widens generated types
with null. A one-hop related dimension must advertise nullable=true because an
unmatched LEFT relationship can produce null independently of its source type.
A filter-only dimension can have groupable=false/orderable=false. Declaring a
dimension does not automatically permit filtering; filters is the allowlist.

A measure descriptor is closed with exactly wireType=string, nullable=true and
having (boolean). Every non-null aggregate is a string, including related
measures, boolean/string-valued arg aggregates and derived results. No aggregate
implementation, dependency formula or physical input appears in the descriptor.

having=true promises numeric HAVING validation/execution for that measure; it
must not be inferred from string wire type. String-valued/unknown-valued
aggregates conservatively advertise false. Metric endpoint measures always
advertise false. Dimension and measure names cannot collide within one endpoint.

Version 1 omits labels/descriptions deliberately. Adding open-ended product
metadata later requires an explicit compatible schema/version decision. Logical
filter aliases may differ from dimension names and reveal no private mapping.

## Filter descriptors and operator/value rules

Each filters key is the literal request field name, including named aliases and
permitted qualified fields. Its closed descriptor contains type (the four
logical types above) and operators (a non-empty, duplicate-free array).

Allowed operators by logical type:

| Type | Operators |
| --- | --- |
| string or timestamp | eq, neq, gt, gte, lt, lte, in, notIn, between, like |
| number | eq, neq, gt, gte, lt, lte, in, notIn, between |
| boolean | eq, neq, in, notIn |

An empty filters record advertises no query filters. An empty operators array
is invalid; it must never widen to every operator. Remove a non-queryable filter
from the projection instead. Related fields require explicit target permissions;
selectability or appearance in a serialized relationship list is insufficient.

For request values, string/timestamp means a JSON string, number means a finite
binary64 JSON number, and boolean means an actual boolean. No string-to-number,
boolean-to-integer or timestamp coercion occurs. Null is not a filter value,
regardless of output nullability. Timestamp strings are not a promise that every
string is a valid database instant; parsing/conversion errors remain safe runtime
input failures. A temporal lexical-format extension is outside this version.

eq/neq/gt/gte/lt/lte require one scalar. like requires one string. in/notIn
require a non-empty homogeneous array bounded by maxFilterValues. between
requires exactly two values of the declared logical category. Order is preserved
in value arrays; neither the contract compiler nor transport sorts query input.
An alias names only a filter unless it is independently a dimension/measure.
Filter nullability does not derive from dimension nullability; null-valued
comparisons require a future explicit operator extension.

## Time and result periods

time is null when the endpoint does not advertise time controls. Otherwise it
is closed with exactly:

- grains: a non-empty, duplicate-free subset of minute, hour, day, week, month,
  quarter, year; only executable grains belong here.
- defaultTimezone: a timezone spelling from the pinned portable registry, such as UTC.
- timezone: boolean, whether an explicit query timezone override is permitted.
- periodFormat: literal calendar-date-or-local-datetime-v1.

It contains no physical time key. A logical timestamp dimension need not be
selectable merely because grain queries are supported. A producer must reject
an unexportable time configuration instead of inventing a visible dimension.
When time is non-null, period is reserved and cannot be a dimension or measure
key. An endpoint without time controls can use period as an ordinary field.

Timezone spellings are pinned by [timezone-names.txt](../fixtures/client-contract-v1/timezone-names.txt)
(597 IANA names/aliases in the reference environments). Membership is exact and
case-sensitive; aliases retain their spelling in identities. Host ICU/zoneinfo
acceptance and case normalization must not determine validation. Registry additions
require an explicit compatible revision and shared fixtures. Missing execution-time
timezone data is a runtime configuration error.

HTTP uses by; MCP translates grain to by. If time is null, neither by nor timezone
is accepted. If time.timezone=false, timezone is absent. Period is present only
when by is supplied. Minute/hour/day periods use YYYY-MM-DD HH:MM:SS wall-clock
text in the query timezone; week/month/quarter/year use YYYY-MM-DD, following
RFC 0015. Ordering period requires a grain in that request.

## Defaults, query validation and results

For dataset endpoints, defaultMeasures is an ordered duplicate-free list of
advertised measure keys. It can be empty. It records what omission of measures
actually selects; advertising a derived/related measure does not add it to the
defaults. Explicit measures=[] selects no measures. An empty object therefore
means default measures, not an empty selection. A query selecting neither a
groupable dimension nor a measure nor a time period is rejected. A producer
must fix or refuse a default configuration that exceeds its effective limits.

Metric endpoints always select their sole output alias and forbid the measures
and having request keys even when their value is [] or null. They accept only
their own advertised dimensions/filters/time controls. A metric-only view cannot
be used to synthesize a general dataset route.

Dataset HTTP request members are dimensions, measures, filters, having, orderBy,
by, timezone, limit, offset and includeMeta. Every member is optional; defaults
are as specified above, empty arrays for dimensions/filters/having/orderBy,
offset=0 and includeMeta=false. No null-valued option is accepted by this strict
profile. Request objects, filter/HAVING conditions and order objects are closed.
HTTP does not accept dataset/metric routing arguments in its JSON body.

Dimension/measure selections preserve caller order and contain no duplicates.
Only groupable dimensions can be selected. orderBy items have exactly field and
direction (asc or desc); fields must be selected orderable dimensions, selected
measures or period with a grain. Measures are orderable by default in this
version. Limits on order count still apply. Repeated order fields are invalid.

HAVING conditions have exactly measure, operator and value. The measure must
be selected and advertise having=true. Operators are eq, neq, gt, gte, lt, lte,
between, in and notIn. Values are finite numbers with the same scalar/range/list
shape rules; scalar measure wire values are still strings in results. filters
and having counts share maxPredicates. A schema compiler must enforce dependent
checks after shape parsing where JSON Schema cannot express them directly.

Unsupported segments, window/shift options, raw SQL, execution settings,
diagnostic flags, tenant/context values and unknown keys are rejected. This
client profile advertises a deliberately bounded subset of legacy self-hosted
input. Its endpoint adapter enforces that profile before planner execution;
acceptance does not silently change legacy endpoints that do not opt into it.

Results retain the existing HTTP envelope: data is an array of scalar row
objects. Its keys are the requested dimensions, resolved selected measures and
optional period. Row values obey the descriptor/nullability guarantees. Derived
dependencies and unrequested/default-disabled measures are not extra row keys.
Unknown row fields or mismatched scalar types are invalid downstream results.

includeMeta=true is accepted only when metadata=true. false is accepted even
when metadata=false. Public metadata has requestId, timingMs, rowCount,
pagination={limit,offset,hasMore}, and optional cache={hit:boolean}; timings are
finite/non-negative, rowCount equals data.length, and pagination reports the
effective returned page size. A later explicit metadata extension is required
for cache outcome detail: hit=false does not distinguish off/miss/bypass.
SQL diagnostics/parameters never enter this profile. Existing safe HTTP error
envelopes remain transport behavior, not a new credential/error schema here.

## Effective limits

limits is closed and requires these safe integers:

| Member | Constraint |
| --- | --- |
| defaultLimit | 1..maxLimit |
| maxLimit | 1..100000 |
| maxOffset | 0..1000000 |
| maxDimensions, maxMeasures, maxPredicates, maxOrderBy | 0..100 |
| maxFilterValues | 1..10000 |

Runtime producers intersect dataset, endpoint, process and client-profile
ceilings. Serving page caps reserve a row for over-fetch. These are advertised
effective ceilings, not independent values the caller may widen. Unknown host
limits must be resolved from trusted export configuration or conservatively
bounded before export. There is no unknown/unbounded numeric sentinel.

Request limit is a positive safe integer; the endpoint clamps it to maxLimit.
Generated types/bridge schemas must not instead reject every larger requested
limit while claiming HTTP parity. Omission uses defaultLimit. offset is a
non-negative safe integer and values over maxOffset fail; it is not clamped.
Booleans and fractional limits/offsets fail. Other count ceilings are rejection
limits. Defaults/fixed metric selection count toward maxMeasures.

MCP can impose lower budgets but cannot widen these values. Its advertised
schema and call validation must use the same lower constraints and clearly
document transport-specific selection requirements. Query cancellation, byte
budgets and runtime admission remain mandatory bridge/server concerns even
though this document carries no execution timeout or response-byte override.

## Canonicalization and identity

All object keys use RFC 8785 JCS ordering. Input endpoint ordering and the order
of operator/grain sets are insignificant; duplicate entries fail rather than
being silently deduplicated. Canonical endpoints are sorted by id, operators
and grains by ascending ASCII spelling. Record keys already sort through JCS.
defaultMeasures order is significant and preserved. Hashes require Unicode
scalar strings/I-JSON values and use the existing JCS numeric rules.

For each endpoint, normalize the declared sets, then remove schemaHash and
limits. Its schemaHash is lowercase SHA-256 of:

~~~text
UTF8("hypequery:client-endpoint-schema:v1\0") || JCS(endpoint without schemaHash and limits)
~~~

Here \0 denotes one NUL byte, not a backslash and zero. All remaining endpoint
members, including route, result shape and defaultMeasures, affect the identity.
Only operational limits are excluded. Two views may share an endpoint schemaHash
while serving different principals or narrower page limits. It is not a business
formula/deployment identity: a formula change without an API-shape change can
retain it, so do not use it to reuse backend result-cache entries.

Normalize the whole document, including its validated endpoint schemaHashes,
then remove contentHash. Its contentHash is lowercase SHA-256 of:

~~~text
UTF8("hypequery:client-contract:v1\0") || JCS(document without contentHash)
~~~

view, visible endpoints, their public schemas and effective limits all affect
contentHash. A build export and metric-only authorized view are not expected to
have the same contentHash. Frontend compatibility compares schemaHash for each
needed endpoint, not equality of entire authorized/build views. The frontend
still handles 401/403 for statically generated operations it cannot invoke.

A consumer validates supplied identities; it cannot merely accept a hash printed
by an untrusted server. Hash identity does not authenticate that server. Changing
these hash rules or reinterpreting a version-1 member requires a new artifact
version and hash domains. No existing artifact hash is redefined here.

## Bounds and deterministic failures

Maximum UTF-8 encoded/canonical document size is 1 MiB; nesting depth is at most
16 (root at depth 1). There are at most 256 endpoints, and at most 256 entries in
each endpoint dimension/measure/filter record. Total descriptor entries across
the document are bounded at 16384. Limits also constrain advertised query arrays.
Live transports may choose a smaller whole-view budget and refuse oversized
views; they must not silently truncate an otherwise claimed complete view.

Unsafe host objects (accessors, custom prototypes/mappings, cycles and other
non-JSON behavior), duplicate JSON object members, unpaired Unicode surrogates
and non-finite numbers are invalid. Do not execute application coercion/accessors
while validating a host value. JavaScript reflection can invoke Proxy traps;
transparent proxies cannot be reliably detected. Reflection failures are sanitized,
and getter/toJSON methods are never called. This API is not a sandbox for a hostile
JavaScript realm. Decode untrusted transport text with the bounded decoder.
Host snapshots additionally allow 100000 nodes and 20000 JSON members per container
(excluding JavaScript arrays' implicit length member). Byte/depth/count bounds must be enforced before
unbounded allocation/traversal; they take precedence over later shape failures.

Stable contract codes:

| Code | Meaning |
| --- | --- |
| HQ_CLIENT_TYPE | Not a supported plain JSON/host value |
| HQ_CLIENT_LIMIT | Document byte/depth/descriptor/endpoint bound exceeded |
| HQ_CLIENT_VERSION | Unsupported artifact kind/version |
| HQ_CLIENT_UNKNOWN_FIELD | Undeclared member in the applicable closed shape |
| HQ_CLIENT_SHAPE | Missing/incorrect member, scalar, enum or bound |
| HQ_CLIENT_IDENTIFIER | Invalid logical/export identifier |
| HQ_CLIENT_DUPLICATE | Duplicate export/path/set/ordered-selection member |
| HQ_CLIENT_PATH | Unsafe or unsupported static path |
| HQ_CLIENT_REFERENCE | Inconsistent binding, default, selection or limit reference |
| HQ_CLIENT_IDENTITY | Malformed or mismatched schema/view hash |
| HQ_CLIENT_QUERY | Invalid input against a validated endpoint contract |

Validation phases are: bounded safe JSON/host materialization; root kind/version;
closed shape/required members and scalar/identifier/path checks (endpoint kind is
read as a discriminator first); uniqueness and
cross-member references; endpoint identity checks in id order; view identity.
Within a closed object, check unknown members before missing required members,
then visit the RFC's listed members in their listed order; visit record keys in
ASCII order and arrays in input order. Within an endpoint, dimension/measure
collision/default/limit consistency checks precede identity verification.
Duplicated id/path/set/default entries report DUPLICATE before cross-references.
Invalid kind/version need not expose lower-level details. Public failure text
must be fixed and safe; values, SQL/provider exceptions and credentials cannot
be echoed. The fixture family pins exact paths/messages. Shape/reference paths
use input endpoint indices; identity paths use normalized id-sorted indices.
Unknown/missing members report their containing object. Invalid field names report
their containing record. Raw decoding and duplicate JSON members report the root,
avoiding attacker property names in failures. Query failures use HQ_CLIENT_QUERY;
structural/selection failures report the root, while invalid limit/offset/timezone
reports that fixed member pointer. Contract failures precede query failures.

| Code suffix | Fixed message |
| --- | --- |
| TYPE | Expected plain JSON data. |
| LIMIT | Client contract exceeds validation limits. |
| VERSION | Unsupported client contract version. |
| UNKNOWN_FIELD | Unknown client contract field. |
| SHAPE | Invalid client contract shape. |
| IDENTIFIER | Invalid client contract identifier. |
| DUPLICATE | Duplicate client contract entry. |
| PATH | Invalid client endpoint path. |
| REFERENCE | Inconsistent client contract reference. |
| IDENTITY | Client contract identity does not match. |
| QUERY | Invalid client query. |

Unsigned preparation refuses supplied identities. Signed validation returns a
detached snapshot: recursively frozen in TypeScript, ordinary typed built-ins in
Python. Query validation revalidates its supplied contract including hashes;
mutating a Python result does not create a trusted validation bypass.

## MCP projection and lifecycle

query_dataset takes dataset=<dataset endpoint id>, and its remaining validated
arguments map to the HTTP body; grain maps to by. query_metric takes
dataset=<endpoint dataset> and metric=<metric endpoint id>. Those routing keys
are removed before HTTP. Metric output alias comes from its sole measure key.
No tool-provided route/origin is consulted. Direct HTTP and the bridge validate
the same endpoint profile, except documented stricter MCP budgets.

Metric-only authorized views can list a dataset group for navigation but must
not advertise it as a query_dataset target. With no callable targets, query
tools retain the existing fixed query_dataset/query_metric names with uncallable
schemas. The empty dataset schema is a strict object requiring dataset: never;
the empty metric schema requires dataset: never and metric: never. No input can
satisfy these schemas. The call path enforces the same unavailable targets.
JSON Schema advertises typed structural constraints; runtime semantic validation
also enforces selection dependencies, uniqueness, portable timezone membership
and combined predicate budgets. Consumers must preserve both steps.

The bridge fetches its live authorized view using its configured principal.
It pins validated hashes for the session, honors cancellation/streamed byte
ceilings, keeps stdout protocol-only and never follows a cross-origin redirect
with the backend credential. A changed view invalidates the compiled schema;
refresh/reconnect must be explicit before executing against it. Reusing a
previously authorized view cannot bypass a newer backend denial. Transport
notification details belong to PX-07/PX-08, not this data-only format.

Schema drift is pinned at execution with the X-Hypequery-Client-Schema request
header. The bridge MUST send its validated endpoint schemaHash on each query.
An opted-in endpoint authenticates and applies current policy first, resolves
its effective descriptor for that request, then compares the header before body
planning/execution. A mismatch returns HTTP 409 through the existing Serve error
envelope with type VALIDATION_ERROR, details.code CLIENT_SCHEMA_CHANGED and message "Client endpoint schema
changed." It exposes no replacement schema or hidden endpoint details. Backend
denial takes precedence over drift disclosure. No query is retried automatically
with changed semantics; explicit refresh/reconnect is required. The header is a
precondition, never authorization. Current limits apply even when schemaHash
matches; limits are excluded from that hash. Browser callers require the matching
CORS allow-header entry.

A preflight discovery fetch alone does not close the race. PX-03/PX-04 must bind
the descriptor check and execution within the same registration/policy snapshot;
PX-07/PX-08 must prove this before the bridge ships. Hashes do not pin database
contents, SQL definitions or business formulas, and this mechanism is not
RFC 0014's activationRevision.

## Acceptance evidence

The [acceptance record](../decisions/0018-client-contract-acceptance.md) resolves
the format review gates and records identity/conformance evidence. Transport
features must satisfy their separate release gates; format acceptance does not
certify them.
